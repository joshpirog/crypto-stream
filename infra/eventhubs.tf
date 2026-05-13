resource "azurerm_eventhub_namespace" "main" {
  name                = "evhns-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku                  = "Standard"
  capacity             = 1
  auto_inflate_enabled = false

  tags = local.tags
}

resource "azurerm_eventhub" "trades" {
  name              = "trades"
  namespace_id      = azurerm_eventhub_namespace.main.id
  partition_count   = var.eventhub_partition_count
  message_retention = var.eventhub_retention_days
}

resource "azurerm_eventhub_consumer_group" "databricks" {
  name                = "databricks"
  namespace_name      = azurerm_eventhub_namespace.main.name
  eventhub_name       = azurerm_eventhub.trades.name
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_eventhub_authorization_rule" "producer_send" {
  name                = "producer-send"
  namespace_name      = azurerm_eventhub_namespace.main.name
  eventhub_name       = azurerm_eventhub.trades.name
  resource_group_name = azurerm_resource_group.main.name

  listen = false
  send   = true
  manage = false
}

resource "azurerm_eventhub_authorization_rule" "databricks_listen" {
  name                = "databricks-listen"
  namespace_name      = azurerm_eventhub_namespace.main.name
  eventhub_name       = azurerm_eventhub.trades.name
  resource_group_name = azurerm_resource_group.main.name

  listen = true
  send   = false
  manage = false
}
