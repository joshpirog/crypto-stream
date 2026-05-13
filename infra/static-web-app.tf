resource "azurerm_static_web_app" "dashboard" {
  name                = "swa-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = "eastus2"

  sku_tier = "Free"
  sku_size = "Free"

  tags = local.tags
}
