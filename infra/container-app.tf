resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = local.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${local.name}-${local.suffix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  tags = local.tags
}

resource "azurerm_container_app" "producer" {
  name                         = "ca-producer-${local.suffix}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.producer.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.producer.id
  }

  secret {
    name  = "eventhub-connection-string"
    value = azurerm_eventhub_authorization_rule.producer_send.primary_connection_string
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "producer"
      image  = var.producer_image
      cpu    = var.producer_cpu
      memory = var.producer_memory

      env {
        name        = "EVENTHUB_CONNECTION_STRING"
        secret_name = "eventhub-connection-string"
      }

      env {
        name  = "EVENTHUB_NAME"
        value = azurerm_eventhub.trades.name
      }

      env {
        name  = "COINBASE_WS_URL"
        value = "wss://ws-feed.exchange.coinbase.com"
      }

      env {
        name  = "SYMBOLS"
        value = "BTC-USD,ETH-USD,SOL-USD"
      }
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
    ]
  }
}
