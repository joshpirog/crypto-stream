variable "project" {
  description = "Short project slug used as the base for every resource name. Lowercase alphanumeric."
  type        = string
  default     = "mktstream"
  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.project))
    error_message = "project must be 3-12 lowercase alphanumeric characters."
  }
}

variable "location" {
  description = "Azure region. Pick one close to you; Databricks + Event Hubs + Cosmos must all support it."
  type        = string
  default     = "eastus"
}

variable "environment" {
  description = "Environment tag (dev/staging/prod). Only one environment is provisioned by this stack."
  type        = string
  default     = "dev"
}

variable "databricks_sku" {
  description = "Databricks workspace SKU. 'standard' is cheapest. 'premium' is required for Unity Catalog."
  type        = string
  default     = "premium"
  validation {
    condition     = contains(["standard", "premium", "trial"], var.databricks_sku)
    error_message = "databricks_sku must be standard, premium, or trial."
  }
}

variable "eventhub_partition_count" {
  description = "Partitions for the trades hub. More partitions = more parallelism in Spark but higher cost. 2 is plenty for a portfolio demo."
  type        = number
  default     = 2
}

variable "eventhub_retention_days" {
  description = "Days to retain events. 1 is the Standard-tier minimum and cheapest."
  type        = number
  default     = 1
}

variable "producer_image" {
  description = "Container image for the WebSocket producer. Defaults to a placeholder; swap for your built image once published."
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "producer_cpu" {
  description = "vCPU for the producer container. 0.25 is fine — it's mostly I/O bound."
  type        = number
  default     = 0.25
}

variable "producer_memory" {
  description = "Memory for the producer container. Must pair with producer_cpu per Container Apps rules."
  type        = string
  default     = "0.5Gi"
}

variable "tags" {
  description = "Tags applied to every resource. Useful for cost attribution in the Azure cost analysis blade."
  type        = map(string)
  default = {
    project = "market-stream"
    owner   = "josh"
  }
}
