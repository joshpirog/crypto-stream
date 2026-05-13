## Project: Real-time crypto market intelligence platform

A streaming pipeline that ingests live crypto trade and order book data from public exchanges, processes it through Databricks Structured Streaming with Delta Lake, computes rolling analytics (VWAP, volatility, anomaly detection, whale-trade alerts), and surfaces it through a public dashboard with live-updating charts. Anyone visiting the URL sees real data flowing in real time, which is what makes it a portfolio piece.

Crypto is the right data source for a portfolio project because the APIs are free, public, high-volume (genuinely tests stream processing), available 24/7 (your demo is always live), and require no auth or compliance work. You could swap it for public transit data, GitHub events, or Wikipedia edits if you prefer.

## Architecture

The flow goes: Coinbase or Binance WebSocket APIs → Azure Event Hubs (Kafka-compatible ingestion) → Azure Databricks Structured Streaming job reading from Event Hubs → Delta Lake tables on ADLS Gen2 in a medallion architecture (bronze for raw events, silver for cleaned and joined data, gold for aggregated analytics) → a serving layer that exposes the gold tables via Databricks SQL Warehouse or by syncing aggregates to Azure Cosmos DB or Postgres → Next.js dashboard on Azure Static Web Apps or Vercel that queries the serving layer and pushes updates to the browser via SSE or websockets.

The medallion architecture matters here because it's the canonical Databricks pattern and interviewers will ask about it. You want bronze tables capturing raw events for replay, silver tables doing the cleanup and enrichment, and gold tables holding the business-level aggregates the dashboard queries.

## What the streaming job actually does

A Structured Streaming job reads trade events from Event Hubs, parses them, and writes to a bronze Delta table with `writeStream`. A second streaming job reads from bronze, computes a rolling 1-minute and 5-minute VWAP per symbol using watermarked windowed aggregations, detects anomalies (price moves beyond N standard deviations, unusually large trades), and writes to silver and gold tables. Use Auto Loader patterns where applicable, demonstrate handling of late-arriving data with watermarks, and use Delta's MERGE for upserts. Schedule it as a Databricks Job with a continuous trigger.

The "anomaly detection" piece is where you can showcase something more sophisticated, even a simple z-score over a rolling window is enough to talk about intelligently in interviews, and it produces visually exciting output (alerts firing in real time on the dashboard).

## The public-facing piece

The dashboard is what makes this a portfolio project rather than a screenshot collection. It should show: live price charts updating in real time, current VWAP and volatility metrics, a feed of detected anomalies and whale trades, and a "pipeline health" panel showing events per second, end-to-end latency, and last update timestamps. That last panel is crucial because it visibly proves the streaming pipeline is alive.

For the serving path, the cheapest and most impressive option is to have your gold-tier streaming job also write to a small Postgres or Cosmos DB instance that the Next.js app queries. Databricks SQL Warehouse works too but the cold-start latency on the serverless tier hurts the demo experience.

## A two-week build plan

**Week 1 — Pipeline**
Days 1-2: Provision Azure resources with Terraform or Bicep (resource group, Databricks workspace, Event Hubs namespace, ADLS Gen2 storage, Postgres or Cosmos DB). Set up a Python producer running on Azure Container Apps or a small VM that connects to the Coinbase WebSocket and publishes to Event Hubs.
Days 3-4: Build the bronze ingestion streaming job in Databricks. Get raw events landing in a Delta table reliably with checkpointing.
Days 5-6: Build silver and gold transformations. Implement windowed aggregations, watermarks, and the anomaly detection logic. Get gold aggregates writing to your serving database.
Day 7: Schedule everything as Databricks Jobs, verify it runs continuously, and fix the inevitable issues (schema evolution, checkpoint corruption, late data).

**Week 2 — Demo and polish**
Days 8-9: Build the Next.js dashboard with live-updating charts (Recharts or Tremor work well). Wire up SSE or polling against your serving database.
Day 10: Deploy the dashboard, make sure the full path is working end-to-end on real infrastructure, get a real domain with HTTPS.
Day 11: Add the pipeline health panel, instrument the streaming jobs to write metrics (events processed, processing time, watermark lag) to a metrics table the dashboard can query.
Day 12: Add Unity Catalog if you want the governance story, set up data quality checks with Delta Live Tables or simple expectations in your job, take screenshots of the Databricks UI for the README.
Day 13: Documentation. Architecture diagram, medallion explanation, ADRs covering why Structured Streaming over Flink, why Delta Lake over plain Parquet, why Event Hubs over Kafka. Include real numbers: events per second, end-to-end latency, cost per day.
Day 14: Loom walkthrough. Show the dashboard live, walk through the Databricks notebooks and job runs, explain the medallion architecture against your diagram, talk about one hard problem.

## A real warning about cost

Azure Databricks is not cheap to leave running 24/7. A small all-purpose cluster runs roughly $1-3/hour depending on instance type and DBU pricing, which adds up fast. A few ways to manage this for a portfolio:

Use **Databricks Jobs Compute** rather than all-purpose clusters, jobs compute is significantly cheaper per DBU. Use the smallest possible node sizes (Standard_DS3_v2 or similar). Apply for Azure free credits ($200 for new accounts, more if you can get the Microsoft for Startups credits). Consider running the pipeline on a schedule (every few minutes in micro-batches) rather than truly continuously, this still demonstrates streaming patterns since Structured Streaming with `Trigger.AvailableNow` is a legitimate production pattern. Budget $100-200 for the project and shut it down when you're not actively job hunting, you can spin it back up for interviews.

If cost is a hard blocker, an honest alternative is to build the same architecture on Databricks Community Edition or use Azure's free-tier services (Event Hubs basic tier, free Postgres) and run Structured Streaming locally with PySpark, then deploy a "snapshot" of recent data to the public dashboard. You lose the truly-live demo but keep the architecture story. Be transparent about this in the README.