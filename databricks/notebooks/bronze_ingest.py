# Databricks notebook source
# MAGIC %md
# MAGIC # Bronze ingestion — raw Coinbase trades from Event Hubs
# MAGIC
# MAGIC Reads the `trades` Event Hub via Spark's built-in **Kafka** connector (the
# MAGIC namespace is Kafka-enabled, so no library install) and writes events to a
# MAGIC bronze Delta table **unparsed**. Cleaning/typing happens in the silver job —
# MAGIC bronze keeps the raw payload for replay.

# COMMAND ----------

from pyspark.sql import functions as F

STORAGE      = "stmktstreamdevlhc7i"
EH_NAMESPACE = "evhns-mktstream-dev-lhc7i"
EH_NAME      = "trades"

BRONZE_PATH = f"abfss://bronze@{STORAGE}.dfs.core.windows.net/trades"
CHECKPOINT  = f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/bronze_trades"

# Listen-only connection string, pulled from the Databricks secret scope (never hardcoded)
eh_conn = dbutils.secrets.get(scope="market-stream", key="eventhub-listen")

# COMMAND ----------

kafka_options = {
    "kafka.bootstrap.servers": f"{EH_NAMESPACE}.servicebus.windows.net:9093",
    "subscribe": EH_NAME,
    "kafka.security.protocol": "SASL_SSL",
    "kafka.sasl.mechanism": "PLAIN",
    # NOTE: kafkashaded.* — Databricks shades the Kafka client. Plain org.apache.kafka.* fails.
    "kafka.sasl.jaas.config": (
        "kafkashaded.org.apache.kafka.common.security.plain.PlainLoginModule "
        f'required username="$ConnectionString" password="{eh_conn}";'
    ),
    "startingOffsets": "latest",   # only events arriving after the stream starts; use "earliest" to drain the buffer
    "failOnDataLoss": "false",     # EH retention is 1 day — tolerate expired offsets
    "maxOffsetsPerTrigger": "5000",
}

# COMMAND ----------

raw = spark.readStream.format("kafka").options(**kafka_options).load()

bronze = raw.select(
    F.col("value").cast("string").alias("body"),   # raw Coinbase JSON, untouched
    F.col("topic"),
    F.col("partition"),
    F.col("offset"),
    F.col("timestamp").alias("enqueued_at"),        # when Event Hubs received it
    F.current_timestamp().alias("ingested_at"),     # when Spark read it
)

# COMMAND ----------

query = (
    bronze.writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", CHECKPOINT)
    .trigger(processingTime="10 seconds")
    .start(BRONZE_PATH)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify rows are landing
# MAGIC Wait ~30s after starting the stream (and make sure the producer is running), then run:

# COMMAND ----------

display(
    spark.read.format("delta").load(BRONZE_PATH)
    .orderBy(F.col("ingested_at").desc())
    .limit(20)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Register as a Unity Catalog external table
# MAGIC Run once, after the first batch has written (the Delta log must exist at the path).
# MAGIC The catalog needs an explicit managed location — we point it at the pre-created
# MAGIC `metastore` container. Bronze/silver/gold tables stay external in their own containers.

# COMMAND ----------

# MAGIC %sql
# MAGIC CREATE EXTERNAL LOCATION IF NOT EXISTS `mktstream-metastore`
# MAGIC   URL 'abfss://metastore@stmktstreamdevlhc7i.dfs.core.windows.net/'
# MAGIC   WITH (STORAGE CREDENTIAL `mktstream-lake`)
# MAGIC   COMMENT 'UC managed storage root for the market catalog';
# MAGIC
# MAGIC CREATE CATALOG IF NOT EXISTS market
# MAGIC   MANAGED LOCATION 'abfss://metastore@stmktstreamdevlhc7i.dfs.core.windows.net/';
# MAGIC
# MAGIC CREATE SCHEMA IF NOT EXISTS market.bronze;
# MAGIC
# MAGIC CREATE TABLE IF NOT EXISTS market.bronze.trades
# MAGIC   USING DELTA
# MAGIC   LOCATION 'abfss://bronze@stmktstreamdevlhc7i.dfs.core.windows.net/trades';
