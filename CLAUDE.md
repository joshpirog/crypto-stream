# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A portfolio project building a real-time crypto market intelligence platform on Azure. Full plan lives in `project-scope.md`. The full stack is now built across four layers:

| Dir | Layer |
|---|---|
| `infra/` | Terraform — the whole Azure data-plane (single-environment, local state) |
| `producer/` | Python WebSocket → Event Hubs forwarder (Docker image, runs on Container Apps) |
| `databricks/` | Structured Streaming notebooks + Asset Bundle — the medallion pipeline |
| `dashboard/` | Next.js 14 terminal UI on Azure Static Web Apps |
| `scripts/` | Ops helpers (`pipeline.ps1` start/stop/status) |

## Architecture (end-to-end flow)

```
Coinbase WebSocket
  → Container App (Python producer) → Event Hubs (Kafka-compat, "trades" hub)
    → Databricks Structured Streaming → ADLS Gen2 Delta (bronze → silver → gold)
      → Cosmos DB (serverless SQL API; vwap_metrics, anomalies, pipeline_health)
        → Next.js dashboard on Azure Static Web Apps
```

The dashboard also opens its **own** browser WebSocket straight to Coinbase for the live trade tape — that's intentionally independent of the pipeline (raw firehose for "liveness"); the Cosmos-backed panels show the processed data.

Key shape decisions:
- **Medallion** in ADLS Gen2 (`stmktstreamdevlhc7i`) — `bronze`/`silver`/`gold`/`checkpoints`/`metastore` filesystems. `metastore` is the UC catalog's managed location.
- **Cosmos serverless** is the serving layer (pay-per-request, scale-to-zero between demos).
- **Databricks → ADLS** via the `azurerm_databricks_access_connector` managed identity (`Storage Blob Data Contributor`), surfaced through UC storage credential + external locations — never keys.
- **Producer → ACR pull** via a dedicated `azurerm_user_assigned_identity` with `AcrPull`; system-assigned pull is NOT supported by `azurerm_container_app.registry.identity`.
- **Cost is the constraint** — see the gotchas below; the NAT Gateway is the surprise line item.

## Working with the infra

All Terraform in `infra/`. Local state (no remote backend).

```powershell
cd C:\Code\crypto-stream\infra
Copy-Item terraform.tfvars.example terraform.tfvars   # first time only
az login
terraform init; terraform plan; terraform apply
```

Useful outputs: `eventhub_listen_connection_string`, `databricks_workspace_url`, `acr_login_server`, `cosmos_endpoint` / `cosmos_primary_key`, `static_web_app_deploy_token`, `container_app_producer_name`. Read sensitive ones with `terraform output -raw <name>`.

## Producer

Python `asyncio` (`websockets` + `azure-eventhub`) in `producer/main.py`. Build/push to ACR, then update the Container App (image is `ignore_changes` so no TF drift):

```powershell
$server = terraform output -raw acr_login_server
az acr login --name (terraform output -raw acr_name)
docker build --platform linux/amd64 -t "$server/producer:dev" .\producer
docker push "$server/producer:dev"
az containerapp update -n (terraform output -raw container_app_producer_name) -g (terraform output -raw resource_group_name) --image "$server/producer:dev"
```

## Databricks pipeline

- **Dev notebooks** (`databricks/notebooks/`): `bronze_ingest`, `silver_transform`, `gold_aggregate`, `cosmos_sink` — built/validated tier-by-tier interactively.
- **`pipeline.py`** is the production entrypoint: runs all streams + `awaitAnyTermination`, deployed as a **continuous job** via the **Asset Bundle** (`databricks.yml`).
- Cluster: **DBR 17.3 LTS (Spark 4.0), Standard access mode, single-node `Standard_D4s_v3`, Photon off**.
- Secret scope **`market-stream`**: `eventhub-listen`, `cosmos-key` (set via Databricks CLI — keeps secrets out of Terraform state).
- UC: catalog `market` (managed location = `metastore` container), schemas `bronze`/`silver`/`gold`, external tables over the `abfss://` paths.

```powershell
cd C:\Code\crypto-stream\databricks
databricks bundle deploy          # creates job (dev mode auto-pauses the continuous trigger)
databricks bundle run market_stream_pipeline
```

**Start/stop cleanly:** `scripts\pipeline.ps1 start|stop|status` toggles the producer AND the job in lockstep, so no backlog accrues during downtime (avoids resume lag).

## Dashboard

- **Next.js 14 + React 18 + Tailwind 3** — pinned because `@tremor/react` v3 requires them; do NOT bump to Next 15 / React 19 / Tailwind 4.
- App Router; `app/api/{vwap,anomalies,health}/route.ts` are `force-dynamic` route handlers querying Cosmos server-side (`@azure/cosmos`); client polls via SWR (`lib/useLive.ts`). Live tape via `lib/useTradeTape.ts` (browser WS to Coinbase).
- **Hybrid** Next.js on SWA (`output_location: ""` in `.github/workflows/azure-static-web-apps.yml`). Cosmos creds live in **SWA Application Settings** (server-side, never in client JS) + GitHub secrets for the build.
- Local dev: `cd dashboard; cp .env.local.example .env.local` (fill `COSMOS_ENDPOINT`/`COSMOS_KEY` from TF outputs); `npm run dev`.

## Operational gotchas (hard-won — don't relearn these)

- **NAT Gateway is the top idle cost (~$32/mo).** Azure Databricks auto-creates it in the managed RG (`rg-mktstream-dev-dbw-managed-*`) for Secure Cluster Connectivity. It bills 24/7 for the workspace's lifetime — pausing clusters/jobs does NOT stop it. Only `terraform destroy` of the workspace kills it.
- **`foreachBatch` on DBR 17 / Standard access mode runs via Spark Connect** — the function is serialized, so it must be self-contained: build clients INSIDE it, don't capture a Spark session / DataFrame / stateful client, and avoid RDD ops like `.toJSON()` (use `.collect()` + `Row.asDict()`).
- **Cosmos has no Spark 4.0 connector** → write from Databricks with the `azure-cosmos` Python SDK in `foreachBatch`; deterministic `id` makes the at-least-once upserts idempotent.
- **Event Hubs via Spark Kafka connector**: the JAAS login module is shaded — `kafkashaded.org.apache.kafka.common.security.plain.PlainLoginModule` (the plain class fails).
- **Clean restart / skip backlog**: `startingOffsets`/`startingVersion`/`startingTimestamp` only apply on a FRESH checkpoint; a fresh Delta stream otherwise snapshots the whole table. Prefer pausing the producer (no backlog) over checkpoint surgery.
- **`az containerapp revision list` returns `[]`** for single-revision apps on the current CLI — use `az containerapp show --query "properties.latestRevisionName"`.
- **Windows PowerShell 5.1 reads BOM-less `.ps1` as the ANSI codepage** → keep scripts ASCII-only (em-dashes, arrows, curly quotes become mojibake that breaks the parser).
- **Creating a UC catalog via SQL needs an explicit `MANAGED LOCATION`** (the UI's Default Storage path isn't available in DDL).

## Conventions

- Resource names: `<azure-abbr>-${local.name}-${local.suffix}`; storage/ACR/Cosmos use no-hyphen variants. `random_string.suffix` keeps globally-scoped names unique.
- Provider pinned `azurerm ~> 4.10`. **Validate schemas with context7 (`/hashicorp/terraform-provider-azurerm`) before writing new resources** — v4 changed several (`partition_key_paths`, `kafka_enabled` removed, `registry.identity` needs a UA identity ID).
- Sensitive outputs are `sensitive = true`; read with `terraform output -raw`.

## Notes
- Always reference Context7 when making changes
