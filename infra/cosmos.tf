resource "azurerm_cosmosdb_account" "main" {
  name                = "cosmos-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  offer_type = "Standard"
  kind       = "GlobalDocumentDB"

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  public_network_access_enabled = true

  tags = local.tags
}

resource "azurerm_cosmosdb_sql_database" "market" {
  name                = "market"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "vwap_metrics" {
  name                = "vwap_metrics"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.market.name
  partition_key_paths = ["/symbol"]
}

resource "azurerm_cosmosdb_sql_container" "anomalies" {
  name                = "anomalies"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.market.name
  partition_key_paths = ["/symbol"]

  default_ttl = 86400
}

resource "azurerm_cosmosdb_sql_container" "pipeline_health" {
  name                = "pipeline_health"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.market.name
  partition_key_paths = ["/job"]

  default_ttl = 3600
}
