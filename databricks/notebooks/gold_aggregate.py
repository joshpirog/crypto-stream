# Databricks notebook source
# MAGIC %md
# MAGIC # Gold — windowed VWAP metrics + anomaly detection
# MAGIC
# MAGIC Two independent streaming queries off the silver table:
# MAGIC 1. **VWAP metrics** — 1-minute windowed aggregation per symbol (vwap, volatility, volume, high/low).
# MAGIC 2. **Anomalies** — `foreachBatch` z-score against a trailing 30-min baseline, plus whale-trade detection.

# COMMAND ----------

from pyspark.sql import functions as F

STORAGE = "stmktstreamdevlhc7i"

GOLD_VWAP_PATH = f"abfss://gold@{STORAGE}.dfs.core.windows.net/vwap_metrics"
GOLD_ANOM_PATH = f"abfss://gold@{STORAGE}.dfs.core.windows.net/anomalies"
VWAP_CKPT = f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/gold_vwap"
ANOM_CKPT = f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/gold_anomalies"

WATERMARK       = "2 minutes"
Z_THRESHOLD     = 3.0        # price moves beyond 3 std devs from the rolling mean
WHALE_NOTIONAL  = 250_000.0  # single trade worth > $250k USD

# COMMAND ----------

# MAGIC %md
# MAGIC ## Stream 1 — VWAP metrics (1-minute tumbling window)

# COMMAND ----------

silver = spark.readStream.table("market.silver.trades")

vwap = (
    silver
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
)

vwap_query = (
    vwap.writeStream
    .format("delta")
    .outputMode("append")   # windows emit once the watermark passes their end
    .option("checkpointLocation", VWAP_CKPT)
    .trigger(processingTime="30 seconds")
    .start(GOLD_VWAP_PATH)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Stream 2 — Anomaly detection (foreachBatch)
# MAGIC For each micro-batch of trades, score against a trailing 30-min per-symbol
# MAGIC baseline (mean/std) and flag z-score outliers and whale trades. `foreachBatch`
# MAGIC lets us run arbitrary batch logic — here a join + filter — inside a stream.

# COMMAND ----------

def detect_anomalies(batch_df, batch_id):
    if batch_df.isEmpty():
        return

    baseline = (
        spark.table("market.silver.trades")
        .where(F.col("event_time") > F.expr("current_timestamp() - INTERVAL 30 MINUTES"))
        .groupBy("symbol")
        .agg(
            F.avg("price").alias("base_mean"),
            F.stddev("price").alias("base_std"),
        )
    )

    scored = (
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
        .select(
            "symbol", "trade_id", "side", "price", "size", "notional",
            "zscore", "anomaly_type", "event_time", "detected_at",
        )
    )

    scored.write.format("delta").mode("append").save(GOLD_ANOM_PATH)


anom_query = (
    spark.readStream.table("market.silver.trades")
    .writeStream
    .foreachBatch(detect_anomalies)
    .option("checkpointLocation", ANOM_CKPT)
    .trigger(processingTime="10 seconds")
    .start()
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Register gold external tables
# MAGIC Run after the streams have written at least one batch each (the Delta log must
# MAGIC exist at each path). Register schemaless — the streaming writes already define
# MAGIC the schema, including watermark metadata on `event_time`.

# COMMAND ----------

# MAGIC %sql
# MAGIC CREATE SCHEMA IF NOT EXISTS market.gold;
# MAGIC
# MAGIC CREATE TABLE IF NOT EXISTS market.gold.vwap_metrics
# MAGIC   USING DELTA
# MAGIC   LOCATION 'abfss://gold@stmktstreamdevlhc7i.dfs.core.windows.net/vwap_metrics';
# MAGIC
# MAGIC CREATE TABLE IF NOT EXISTS market.gold.anomalies
# MAGIC   USING DELTA
# MAGIC   LOCATION 'abfss://gold@stmktstreamdevlhc7i.dfs.core.windows.net/anomalies';
