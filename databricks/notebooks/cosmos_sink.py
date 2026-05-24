# Databricks notebook source
# MAGIC %md
# MAGIC # Cosmos sink — project gold tables to the serving layer
# MAGIC
# MAGIC Reads the gold Delta tables as streams and upserts rows into the Cosmos DB
# MAGIC containers the Next.js dashboard queries. Uses the **azure-cosmos Python SDK**
# MAGIC in `foreachBatch` — the Cosmos *Spark* connector has no Spark 4.0 / DBR 17 build,
# MAGIC and at gold volume (a handful of rows per batch) driver-side upserts are plenty.

# COMMAND ----------

# MAGIC %pip install azure-cosmos
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

import datetime
from azure.cosmos import CosmosClient
from pyspark.sql import functions as F

STORAGE    = "stmktstreamdevlhc7i"
COSMOS_URI = "https://cosmos-mktstream-dev-lhc7i.documents.azure.com:443/"
COSMOS_KEY = dbutils.secrets.get(scope="market-stream", key="cosmos-key")
COSMOS_DB  = "market"

def ckpt(name):
    return f"abfss://checkpoints@{STORAGE}.dfs.core.windows.net/cosmos_{name}"

def cosmos_container(name):
    # Created INSIDE foreachBatch (see below) — a client captured from the enclosing
    # scope can't be serialized by Spark Connect on DBR 17 (it holds a thread RLock).
    return CosmosClient(COSMOS_URI, COSMOS_KEY).get_database_client(COSMOS_DB).get_container_client(name)

def to_doc(row):
    # Row -> JSON-safe dict. Cosmos json.dumps can't handle datetime, so ISO-format them.
    out = {}
    for k, v in row.asDict(recursive=True).items():
        out[k] = v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v
    return out

# COMMAND ----------

def make_sink(container_name, id_fn):
    """foreachBatch fn: upsert each row of the batch into a Cosmos container.
    The item body must carry the container's partition-key field."""
    def _sink(batch_df, batch_id):
        rows = batch_df.collect()   # .toJSON() is RDD-based and unsupported on Spark Connect
        if not rows:
            return
        container = cosmos_container(container_name)   # build the client here, don't capture it
        for row in rows:
            item = to_doc(row)
            item["id"] = id_fn(item)
            container.upsert_item(item)

    return _sink

# COMMAND ----------

# MAGIC %md ## VWAP metrics → Cosmos `vwap_metrics` (partition key `/symbol`)

# COMMAND ----------

vwap_q = (
    spark.readStream.table("market.gold.vwap_metrics")
    .writeStream
    .foreachBatch(make_sink("vwap_metrics", lambda r: f'{r["symbol"]}_{r["window_start"]}'))
    .option("checkpointLocation", ckpt("vwap"))
    .trigger(processingTime="30 seconds")
    .start()
)

# COMMAND ----------

# MAGIC %md ## Anomalies → Cosmos `anomalies` (partition key `/symbol`)

# COMMAND ----------

anom_q = (
    spark.readStream.table("market.gold.anomalies")
    .writeStream
    .foreachBatch(make_sink("anomalies", lambda r: f'{r["symbol"]}_{r["trade_id"]}_{r["detected_at"]}'))
    .option("checkpointLocation", ckpt("anomalies"))
    .trigger(processingTime="15 seconds")
    .start()
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Pipeline health → Cosmos `pipeline_health` (partition key `/job`)
# MAGIC A heartbeat the dashboard's health panel reads — proves the pipeline is alive
# MAGIC and shows throughput + freshness even when no anomalies are firing.

# COMMAND ----------

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

health_q = (
    spark.readStream.table("market.silver.trades")
    .writeStream
    .foreachBatch(health_sink)
    .option("checkpointLocation", ckpt("health"))
    .trigger(processingTime="15 seconds")
    .start()
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify in Cosmos
# MAGIC After ~1 minute, check rows are landing (Data Explorer in the Azure portal, or):

# COMMAND ----------

verify_db = CosmosClient(COSMOS_URI, COSMOS_KEY).get_database_client(COSMOS_DB)
for name in ["vwap_metrics", "anomalies", "pipeline_health"]:
    n = list(verify_db.get_container_client(name).query_items(
        "SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))[0]
    print(f"{name}: {n} docs")
