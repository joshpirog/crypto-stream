# crypto-stream

A real-time crypto market intelligence platform on Azure. A Python producer streams live
Coinbase trades into Event Hubs; a Databricks Structured Streaming job runs them through a
medallion (bronze → silver → gold) Delta pipeline computing VWAP, volatility, and anomaly
detection; results land in Cosmos DB and surface on a Next.js terminal-style dashboard.

Anyone visiting the dashboard URL sees real market data flowing in real time — that's what
makes it a portfolio piece rather than a screenshot collection. The full design rationale and
two-week build plan live in [`project-scope.md`](project-scope.md).

## Architecture

```
Coinbase WebSocket
  → Container App (Python producer) → Event Hubs (Kafka-compatible "trades" hub)
    → Databricks Structured Streaming → ADLS Gen2 Delta (bronze → silver → gold)
      → Cosmos DB (serverless; vwap_metrics, anomalies, pipeline_health)
        → Next.js dashboard on Azure Static Web Apps
```

The dashboard also opens its **own** browser WebSocket straight to Coinbase for the live trade
tape — intentionally independent of the pipeline (a raw firehose that proves "liveness"), while
the Cosmos-backed panels show the processed analytics.

### Why these pieces

- **Medallion on ADLS Gen2 Delta** — bronze keeps raw events for replay, silver cleans/types
  them, gold holds the business aggregates the dashboard reads. The canonical Databricks pattern.
- **Cosmos DB serverless** as the serving layer — pay-per-request and scales to zero between
  demos, and it dodges the cold-start latency of a serverless SQL Warehouse.
- **Event Hubs** for ingestion — Kafka-compatible, so Databricks reads it with the standard
  Spark Kafka connector; no separate Kafka cluster to run.
- **Managed identity everywhere** — Databricks → ADLS via an access connector (Unity Catalog
  storage credential + external locations), producer → ACR via a user-assigned identity with
  `AcrPull`. No storage keys in code.

## Repository layout

| Dir | Layer |
|---|---|
| [`infra/`](infra/) | Terraform — the whole Azure data plane (single environment, local state) |
| [`producer/`](producer/) | Python `asyncio` WebSocket → Event Hubs forwarder (Docker, runs on Container Apps) |
| [`databricks/`](databricks/) | Structured Streaming notebooks + Asset Bundle — the medallion pipeline |
| [`dashboard/`](dashboard/) | Next.js 14 terminal UI on Azure Static Web Apps |
| [`scripts/`](scripts/) | Ops helpers — `pipeline.ps1 start|stop|status` |

## Tech stack

- **Infra:** Terraform (`azurerm ~> 4.10`), Azure — Event Hubs, ADLS Gen2, Databricks, Cosmos DB,
  Container Apps, ACR, Static Web Apps.
- **Producer:** Python (`websockets` + `azure-eventhub`), Docker.
- **Pipeline:** Databricks DBR 17.3 LTS / Spark 4.0, Delta Lake, Unity Catalog, deployed as a
  continuous job via Databricks Asset Bundles.
- **Serving:** Azure Cosmos DB (serverless SQL API), written from Databricks with the
  `azure-cosmos` Python SDK.
- **Dashboard:** Next.js 14, React 18, Tailwind 3, `@tremor/react`, SWR.

## What the pipeline computes

- **Bronze** — raw Coinbase `match` events landed to Delta with checkpointing.
- **Silver** — parsed, typed, watermarked trades.
- **Gold** — two independent streams off silver:
  - **`vwap_metrics`** — 1-minute tumbling window per symbol: VWAP, volatility, volume, high/low.
  - **`anomalies`** — z-score against a trailing baseline (price moves > 3σ) plus whale-trade
    detection (single trade > $250k notional).
- **`pipeline_health`** — throughput / latency / last-update metrics that prove the stream is live.

The two gold tables plus a `pipeline_health` heartbeat are written into Cosmos containers
(`vwap_metrics`, `anomalies`, `pipeline_health`) via `foreachBatch`, using a deterministic `id`
so the at-least-once upserts stay idempotent.

## Quick start

Prerequisites: an Azure subscription, `az` CLI, Terraform, Docker, the Databricks CLI, and Node 18+.

### 1. Provision infrastructure

```powershell
cd infra
Copy-Item terraform.tfvars.example terraform.tfvars   # first time only
az login
terraform init; terraform plan; terraform apply
```

Useful outputs (read sensitive ones with `terraform output -raw <name>`):
`eventhub_listen_connection_string`, `databricks_workspace_url`, `acr_login_server`,
`cosmos_endpoint` / `cosmos_primary_key`, `static_web_app_deploy_token`,
`container_app_producer_name`.

### 2. Build & deploy the producer

```powershell
$server = terraform output -raw acr_login_server
az acr login --name (terraform output -raw acr_name)
docker build --platform linux/amd64 -t "$server/producer:dev" ..\producer
docker push "$server/producer:dev"
az containerapp update -n (terraform output -raw container_app_producer_name) `
  -g (terraform output -raw resource_group_name) --image "$server/producer:dev"
```

### 3. Deploy the Databricks pipeline

Create the `market-stream` secret scope (`eventhub-listen`, `cosmos-key`) via the Databricks CLI,
then deploy and run the bundle:

```powershell
cd databricks
databricks bundle deploy          # dev mode auto-pauses the continuous trigger
databricks bundle run market_stream_pipeline
```

### 4. Run the dashboard

```powershell
cd dashboard
Copy-Item .env.local.example .env.local   # fill COSMOS_ENDPOINT / COSMOS_KEY from TF outputs
npm install
npm run dev
```

Production deploys automatically to Azure Static Web Apps via
[`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml).
Cosmos credentials live in SWA Application Settings (server-side, never in client JS).

## Operating the pipeline

`scripts/pipeline.ps1` toggles the producer **and** the Databricks job in lockstep, so no backlog
accrues during downtime:

```powershell
scripts\pipeline.ps1 start    # producer + job on
scripts\pipeline.ps1 stop     # both off — no backlog builds up
scripts\pipeline.ps1 status
```

## A note on cost

Cost is the real constraint for a 24/7 portfolio demo. The surprise line item is the **NAT
Gateway (~$32/mo)** that Azure Databricks auto-creates in its managed resource group for Secure
Cluster Connectivity — it bills continuously for the workspace's lifetime and pausing clusters
does **not** stop it. Only `terraform destroy` of the workspace kills it. Cosmos serverless and
Container Apps scale to near-zero between demos, so tear the Databricks workspace down when you're
not actively demoing.

## Development notes

More detail — schema decisions, the Spark Connect / `foreachBatch` gotchas, the shaded Kafka JAAS
module, checkpoint/backlog handling, and other hard-won lessons — lives in
[`CLAUDE.md`](CLAUDE.md).
</content>
</invoke>
