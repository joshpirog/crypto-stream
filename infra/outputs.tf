output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "storage_account_name" {
  value = azurerm_storage_account.lake.name
}

output "storage_account_dfs_endpoint" {
  value = azurerm_storage_account.lake.primary_dfs_endpoint
}

output "databricks_workspace_url" {
  value = "https://${azurerm_databricks_workspace.main.workspace_url}"
}

output "databricks_access_connector_id" {
  description = "Pass this to a Unity Catalog storage credential to let Databricks read ADLS via managed identity."
  value       = azurerm_databricks_access_connector.lake.id
}

output "eventhub_namespace" {
  value = azurerm_eventhub_namespace.main.name
}

output "eventhub_name" {
  value = azurerm_eventhub.trades.name
}

output "eventhub_producer_connection_string" {
  value     = azurerm_eventhub_authorization_rule.producer_send.primary_connection_string
  sensitive = true
}

output "eventhub_listen_connection_string" {
  description = "Use this in the Databricks streaming job to read from the trades hub."
  value       = azurerm_eventhub_authorization_rule.databricks_listen.primary_connection_string
  sensitive   = true
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.main.endpoint
}

output "cosmos_primary_key" {
  value     = azurerm_cosmosdb_account.main.primary_key
  sensitive = true
}

output "cosmos_database" {
  value = azurerm_cosmosdb_sql_database.market.name
}

output "container_app_producer_name" {
  value = azurerm_container_app.producer.name
}

output "acr_name" {
  value = azurerm_container_registry.main.name
}

output "acr_login_server" {
  description = "Tag/push images here. Example: docker tag producer:dev $(acr_login_server)/producer:dev"
  value       = azurerm_container_registry.main.login_server
}

output "static_web_app_hostname" {
  value = azurerm_static_web_app.dashboard.default_host_name
}

output "static_web_app_deploy_token" {
  description = "Paste into your GitHub repo as AZURE_STATIC_WEB_APPS_API_TOKEN for the SWA deploy action."
  value       = azurerm_static_web_app.dashboard.api_key
  sensitive   = true
}
