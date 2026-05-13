# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A portfolio project building a real-time crypto market intelligence platform on Azure. Full plan lives in `project-scope.md` — read it first when context is missing. As of now the repo contains **only Terraform** for the Azure data-plane (no application code yet). The application layers — WebSocket producer, Databricks notebooks/jobs, Next.js dashboard — are still to be built per the Week-1/Week-2 plan in the scope doc.

## Architecture (target end-state)

End-to-end flow:

```
Coinbase WebSocket
  → Container App (Python producer) → Event Hubs (Kafka-compat, "trades" hub)
    → Databricks Structured Streaming → ADLS Gen2 Delta (bronze → silver → gold)
      → Cosmos DB (serverless SQL API; vwap_metrics, anomalies, pipeline_health)
        → Next.js dashboard on Azure Static Web Apps
```

Key shape decisions baked into the infra:
- **Medallion architecture** in ADLS Gen2 — `bronze`/`silver`/`gold`/`checkpoints`/`metastore` filesystems are pre-created.
- **Cosmos DB serverless** is the serving layer (chosen over Postgres for pay-per-request and scale-to-zero between demos).
- **Databricks → ADLS access** is via the workspace's `azurerm_databricks_access_connector` (managed identity, `Storage Blob Data Contributor`), not connection strings. Wire this to a Unity Catalog storage credential in the workspace.
- **Producer → ACR pull** is via a dedicated `azurerm_user_assigned_identity` with `AcrPull`, attached to the Container App. System-assigned-identity pull is *not* supported by `azurerm_container_app.registry.identity` — only user-assigned identity resource IDs.
- **Cost is the constraint, not engineering** — Premium Databricks workspace is for Unity Catalog support, but compute (clusters/jobs) is configured outside Terraform. The scope doc has the Jobs Compute / shut-down-when-idle guidance.

## Working with the infra

All Terraform lives in `infra/`. Single-environment stack (no per-env directories or workspaces).

```powershell
cd C:\Code\market-stream\infra
Copy-Item terraform.tfvars.example terraform.tfvars   # first time only
az login                                              # provider uses Azure CLI auth
terraform init
terraform plan
terraform apply
```

State is **local** — no remote backend configured. Fine for solo portfolio work; add an `azurerm` backend block to `versions.tf` if collaborating.

Useful outputs after apply:
- `terraform output -raw eventhub_listen_connection_string` — paste into Databricks streaming job config
- `terraform output -raw databricks_workspace_url` — open the workspace
- `terraform output -raw acr_login_server` — target for `docker push`
- `terraform output -raw static_web_app_deploy_token` — `AZURE_STATIC_WEB_APPS_API_TOKEN` for GitHub Actions

## Producer image workflow

The Container App is created with a placeholder image (`mcr.microsoft.com/azuredocs/containerapps-helloworld`). `lifecycle.ignore_changes = [template[0].container[0].image]` is set so the image can be updated out-of-band without Terraform drift:

```powershell
$acr = terraform output -raw acr_name
$server = terraform output -raw acr_login_server
az acr login --name $acr
docker build -t "$server/producer:dev" .\producer
docker push "$server/producer:dev"
az containerapp update -n (terraform output -raw container_app_producer_name) `
                       -g (terraform output -raw resource_group_name) `
                       --image "$server/producer:dev"
```

First pull after `terraform apply` may fail for ~30–60s while the `AcrPull` role assignment propagates — restart the revision or wait.

## Conventions when editing infra

- Resource names use the pattern `<azure-abbr>-${local.name}-${local.suffix}` (e.g. `dbw-mktstream-dev-a1b2c`). Storage/ACR/Cosmos use no-hyphen variants because Azure rejects hyphens in those. The `random_string.suffix` exists to keep globally-scoped names unique across redeploys.
- Provider is pinned to `azurerm ~> 4.10`. **Validate with context7 (`/hashicorp/terraform-provider-azurerm`) before writing new resources** — v4 changed several schemas (e.g. `partition_key_path` → `partition_key_paths`, `kafka_enabled` removed from `eventhub_namespace`, `registry.identity` requires UA identity resource ID).
- Sensitive outputs are marked `sensitive = true` — read them with `terraform output -raw <name>`.
