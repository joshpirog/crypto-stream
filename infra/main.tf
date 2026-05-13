resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
  numeric = true
}

locals {
  suffix = random_string.suffix.result
  name   = "${var.project}-${var.environment}"
  tags   = merge(var.tags, { environment = var.environment })
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}
