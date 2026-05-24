# Databricks notebook source
# MAGIC %md
# MAGIC # Silver — parse, type, dedup, watermark
# MAGIC
# MAGIC Reads the bronze stream, parses the raw Coinbase `match` JSON into typed
# MAGIC columns, drops duplicate trades (Event Hubs is at-least-once), and applies a
# MAGIC watermark on event time so downstream windowed aggregations can handle late data.

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, LongType

STORAGE = "stmktstreamdevlhc7i"
SILVER_PATH = f"abfss://silver@{STORAGE}.dfs.core.windows.net/trades"
SILVER_CKPT = f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/silver_trades"

WATERMARK = "2 minutes"   # how long to wait for late/out-of-order trades

# COMMAND ----------

# Coinbase Exchange "match" message — numbers arrive as strings, time is ISO-8601.
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

# COMMAND ----------

bronze = spark.readStream.table("market.bronze.trades")

silver = (
    bronze
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
)

# COMMAND ----------

query = (
    silver.writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", SILVER_CKPT)
    .trigger(processingTime="10 seconds")
    .start(SILVER_PATH)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify + register external table (after first batch writes)

# COMMAND ----------

display(
    spark.read.format("delta").load(SILVER_PATH)
    .orderBy(F.col("event_time").desc())
    .limit(20)
)

# COMMAND ----------

# MAGIC %sql
# MAGIC CREATE SCHEMA IF NOT EXISTS market.silver;
# MAGIC CREATE TABLE  IF NOT EXISTS market.silver.trades
# MAGIC   USING DELTA
# MAGIC   LOCATION 'abfss://silver@stmktstreamdevlhc7i.dfs.core.windows.net/trades';
