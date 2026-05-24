# Databricks notebook source
# MAGIC %md
# MAGIC # Production pipeline entrypoint (continuous job)
# MAGIC
# MAGIC Starts all four streams on one cluster and blocks on `awaitAnyTermination`.
# MAGIC Deployed as a continuous job via the Asset Bundle (`databricks.yml`). Assumes
# MAGIC the UC catalog/schemas/tables and secret scope already exist (created during
# MAGIC interactive dev). `azure-cosmos` is provided as a job-cluster library, so there
# MAGIC is no `%pip`/`restartPython` here.

# COMMAND ----------

import datetime
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, LongType

STORAGE      = "stmktstreamdevlhc7i"
EH_NAMESPACE = "evhns-mktstream-dev-lhc7i"
EH_NAME      = "trades"
COSMOS_URI   = "https://cosmos-mktstream-dev-lhc7i.documents.azure.com:443/"
COSMOS_DB    = "market"

EH_CONN    = dbutils.secrets.get(scope="market-stream", key="eventhub-listen")
COSMOS_KEY = dbutils.secrets.get(scope="market-stream", key="cosmos-key")

Z_THRESHOLD    = 3.0
WHALE_NOTIONAL = 250_000.0
WATERMARK      = "2 minutes"

def lake(container, sub):
    return f"abfss://{container}@{STORAGE}.dfs.core.windows.net/{sub}"

def ckpt(name):
    return f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/{name}"

# COMMAND ----------

# ---------- Bronze: Event Hubs (Kafka) -> raw Delta ----------
kafka_options = {
    "kafka.bootstrap.servers": f"{EH_NAMESPACE}.servicebus.windows.net:9093",
    "subscribe": EH_NAME,
    "kafka.security.protocol": "SASL_SSL",
    "kafka.sasl.mechanism": "PLAIN",
    "kafka.sasl.jaas.config": (
        "kafkashaded.org.apache.kafka.common.security.plain.PlainLoginModule "
        f'required username="$ConnectionString" password="{EH_CONN}";'
    ),
    "startingOffsets": "latest",
    "failOnDataLoss": "false",
    "maxOffsetsPerTrigger": "5000",
}

(
    spark.readStream.format("kafka").options(**kafka_options).load()
    .select(
        F.col("value").cast("string").alias("body"),
        F.col("topic"), F.col("partition"), F.col("offset"),
        F.col("timestamp").alias("enqueued_at"),
        F.current_timestamp().alias("ingested_at"),
    )
    .writeStream.format("delta").outputMode("append")
    .option("checkpointLocation", ckpt("bronze_trades"))
    .trigger(processingTime="10 seconds")
    .start(lake("bronze", "trades"))
)

# COMMAND ----------

# ---------- Silver: parse, type, dedup, watermark ----------
match_schema = StructType([
    StructField("type", StringType()),
    StructField("trade_id", LongType()),
    StructField("side", StringType()),
    StructField("size", StringType()),
    StructField("price", StringType()),
    StructField("product_id", StringType()),
    StructField("sequence", LongType()),
    StructField("time", StringType()),
])

(
    spark.readStream.table("market.bronze.trades")
    .select(F.from_json("body", match_schema).alias("m"))
    .where(F.col("m.type") == "match")
    .select(
        F.col("m.product_id").alias("symbol"),
        F.col("m.trade_id").alias("trade_id"),
        F.col("m.side").alias("side"),
        F.col("m.price").cast("double").alias("price"),
        F.col("m.size").cast("double").alias("size"),
        (F.col("m.price").cast("double") * F.col("m.size").cast("double")).alias("notional"),
        F.to_timestamp("m.time").alias("event_time"),
    )
    .withWatermark("event_time", WATERMARK)
    .dropDuplicatesWithinWatermark(["symbol", "trade_id"])
    .writeStream.format("delta").outputMode("append")
    .option("checkpointLocation", ckpt("silver_trades"))
    .trigger(processingTime="10 seconds")
    .start(lake("silver", "trades"))
)

# COMMAND ----------

# ---------- Gold: windowed VWAP metrics ----------
(
    spark.readStream.table("market.silver.trades")
    .withWatermark("event_time", WATERMARK)
    .groupBy(F.window("event_time", "1 minute"), "symbol")
    .agg(
        (F.sum(F.col("price") * F.col("size")) / F.sum("size")).alias("vwap"),
        F.avg("price").alias("avg_price"),
        F.stddev("price").alias("stddev_price"),
        F.min("price").alias("low"),
        F.max("price").alias("high"),
        F.sum("size").alias("volume"),
        F.count("*").alias("trade_count"),
    )
    .select(
        "symbol",
        F.col("window.start").alias("window_start"),
        F.col("window.end").alias("window_end"),
        "vwap", "avg_price", "stddev_price", "low", "high", "volume", "trade_count",
    )
    .writeStream.format("delta").outputMode("append")
    .option("checkpointLocation", ckpt("gold_vwap"))
    .trigger(processingTime="30 seconds")
    .start(lake("gold", "vwap_metrics"))
)

# COMMAND ----------

# ---------- Gold: anomaly detection (z-score + whale) ----------
def detect_anomalies(batch_df, batch_id):
    if batch_df.isEmpty():
        return
    baseline = (
        batch_df.sparkSession.table("market.silver.trades")
        .where(F.col("event_time") > F.expr("current_timestamp() - INTERVAL 30 MINUTES"))
        .groupBy("symbol")
        .agg(F.avg("price").alias("base_mean"), F.stddev("price").alias("base_std"))
    )
    (
        batch_df.join(baseline, "symbol", "left")
        .withColumn(
            "zscore",
            F.when(F.col("base_std") > 0, (F.col("price") - F.col("base_mean")) / F.col("base_std"))
             .otherwise(F.lit(0.0)),
        )
        .withColumn("is_whale", F.col("notional") > F.lit(WHALE_NOTIONAL))
        .withColumn("is_spike", F.abs(F.col("zscore")) > F.lit(Z_THRESHOLD))
        .where(F.col("is_whale") | F.col("is_spike"))
        .withColumn(
            "anomaly_type",
            F.when(F.col("is_whale") & F.col("is_spike"), F.lit("whale+spike"))
             .when(F.col("is_whale"), F.lit("whale"))
             .otherwise(F.lit("price_spike")),
        )
        .withColumn("detected_at", F.current_timestamp())
        .select("symbol", "trade_id", "side", "price", "size", "notional",
                "zscore", "anomaly_type", "event_time", "detected_at")
        .write.format("delta").mode("append").save(lake("gold", "anomalies"))
    )

(
    spark.readStream.table("market.silver.trades")
    .writeStream.foreachBatch(detect_anomalies)
    .option("checkpointLocation", ckpt("gold_anomalies"))
    .trigger(processingTime="10 seconds")
    .start()
)

# COMMAND ----------

# ---------- Cosmos serving sinks ----------
def cosmos_container(name):
    from azure.cosmos import CosmosClient
    return CosmosClient(COSMOS_URI, COSMOS_KEY).get_database_client(COSMOS_DB).get_container_client(name)

def to_doc(row):
    out = {}
    for k, v in row.asDict(recursive=True).items():
        out[k] = v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v
    return out

def make_sink(container_name, id_fn):
    def _sink(batch_df, batch_id):
        rows = batch_df.collect()
        if not rows:
            return
        container = cosmos_container(container_name)
        for row in rows:
            item = to_doc(row)
            item["id"] = id_fn(item)
            container.upsert_item(item)
    return _sink

def health_sink(batch_df, batch_id):
    row = batch_df.agg(
        F.count("*").alias("events"),
        F.max("event_time").alias("last_event_time"),
    ).collect()[0]
    cosmos_container("pipeline_health").upsert_item({
        "id": "streaming",
        "job": "streaming",
        "events_last_batch": int(row["events"]),
        "last_event_time": str(row["last_event_time"]),
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    })

(
    spark.readStream.table("market.gold.vwap_metrics")
    .writeStream.foreachBatch(make_sink("vwap_metrics", lambda r: f'{r["symbol"]}_{r["window_start"]}'))
    .option("checkpointLocation", ckpt("cosmos_vwap"))
    .trigger(processingTime="30 seconds")
    .start()
)

(
    spark.readStream.table("market.gold.anomalies")
    .writeStream.foreachBatch(make_sink("anomalies", lambda r: f'{r["symbol"]}_{r["trade_id"]}_{r["detected_at"]}'))
    .option("checkpointLocation", ckpt("cosmos_anomalies"))
    .trigger(processingTime="15 seconds")
    .start()
)

(
    spark.readStream.table("market.silver.trades")
    .writeStream.foreachBatch(health_sink)
    .option("checkpointLocation", ckpt("cosmos_health"))
    .trigger(processingTime="15 seconds")
    .start()
)

# COMMAND ----------

# Block the job run on all streams; if any fails, the run fails and the continuous
# trigger restarts it (resuming each stream from its checkpoint).
spark.streams.awaitAnyTermination()
