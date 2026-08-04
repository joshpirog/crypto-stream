<#
.SYNOPSIS
  Start / stop / status the market-stream pipeline cleanly.

.DESCRIPTION
  Toggles the Container App producer AND the Databricks streaming job in lockstep.
  Stopping the producer means no trades accumulate in Event Hubs during downtime,
  so on start the job resumes from its checkpoint with no backlog to drain - only
  the normal ~2-minute watermark delay. (Option 1: prevent lag, no checkpoint surgery.)

  Resolves the resource group, producer name, and job id from Terraform outputs and
  the deployed Asset Bundle, so there is nothing to hardcode.

.EXAMPLE
  .\scripts\pipeline.ps1 start
  .\scripts\pipeline.ps1 stop
  .\scripts\pipeline.ps1 status
#>
param(
  [Parameter(Mandatory)]
  [ValidateSet("start", "stop", "status")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InfraDir = Join-Path $RepoRoot "infra"

function Resolve-Context {
  Push-Location $InfraDir
  try {
    $rg       = terraform output -raw resource_group_name
    $producer = terraform output -raw container_app_producer_name
  } finally { Pop-Location }
  if (-not $rg -or -not $producer) {
    throw "Couldn't read Terraform outputs. Is the stack applied? (cd infra; terraform apply)"
  }

  # Job id from the deployed bundle. Prefer the exact single-target name; fall
  # back to a loose match only for a legacy [dev <user>]-prefixed deploy.
  $raw  = databricks jobs list -o json | ConvertFrom-Json
  $list = if ($raw.jobs) { $raw.jobs } else { $raw }
  $job  = $list | Where-Object { $_.settings.name -eq "market-stream-pipeline" } | Select-Object -First 1
  if (-not $job) {
    $job = $list | Where-Object { $_.settings.name -like "*market-stream-pipeline*" } | Select-Object -First 1
  }
  if (-not $job) { throw "No market-stream-pipeline job found. Deploy the bundle first (databricks bundle deploy)." }

  # Single-revision app: toggle the latest revision. (Use `show`, not `revision list`
  # -- the latter returns [] for single-revision apps on some az CLI versions.)
  $rev = az containerapp show -n $producer -g $rg --query "properties.latestRevisionName" -o tsv
  if (-not $rev) { throw "No revision found for container app '$producer'." }

  [pscustomobject]@{ Rg = $rg; Producer = $producer; Revision = $rev; JobId = $job.job_id }
}

function Assert-LastExit($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

# Toggle the continuous trigger. This is the ONLY way to stop a continuous job:
# cancelling a run alone gets undone - the trigger relaunches it from checkpoint.
# NOTE: this writes drift from the bundle (which pins UNPAUSED); a later
# `databricks bundle deploy` resets it to UNPAUSED, which is the intended "go
# live" behaviour.
function Set-JobPauseStatus($JobId, $Status) {
  # `job_id` must live INSIDE the payload -- the CLI rejects a positional
  # job_id whenever --json is used. Cast to int64 so it serializes as a
  # number, not a quoted string.
  $payload = @{
    job_id       = [int64]$JobId
    new_settings = @{ continuous = @{ pause_status = $Status } }
  } | ConvertTo-Json -Depth 6 -Compress
  $tmp = New-TemporaryFile
  try {
    Set-Content -Path $tmp.FullName -Value $payload -Encoding ascii
    databricks jobs update --json "@$($tmp.FullName)" | Out-Null
    Assert-LastExit "job set pause_status=$Status"
  } finally {
    Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
  }
}

$ctx = Resolve-Context
Write-Host "rg=$($ctx.Rg)  producer=$($ctx.Producer)  rev=$($ctx.Revision)  job=$($ctx.JobId)" -ForegroundColor DarkGray

switch ($Action) {
  "stop" {
    # Pause FIRST so the continuous trigger cannot relaunch the run we cancel.
    Write-Host "-> pausing Databricks continuous trigger..." -ForegroundColor Yellow
    Set-JobPauseStatus $ctx.JobId "PAUSED"

    Write-Host "-> cancelling active job run..." -ForegroundColor Yellow
    databricks jobs cancel-all-runs --job-id $ctx.JobId | Out-Null
    Assert-LastExit "job cancel-all-runs"

    Write-Host "-> deactivating producer revision..." -ForegroundColor Yellow
    az containerapp revision deactivate -n $ctx.Producer -g $ctx.Rg --revision $ctx.Revision | Out-Null
    Assert-LastExit "producer deactivate"

    Write-Host "STOPPED - trigger paused, run cancelled, producer off. Cluster spins down; no backlog builds up." -ForegroundColor Green
  }

  "start" {
    Write-Host "-> activating producer revision..." -ForegroundColor Yellow
    az containerapp revision activate -n $ctx.Producer -g $ctx.Rg --revision $ctx.Revision | Out-Null
    Assert-LastExit "producer activate"

    # Unpausing the continuous trigger makes the scheduler launch the run itself
    # (resumes from checkpoint). No blocking `bundle run` needed.
    Write-Host "-> unpausing Databricks continuous trigger (scheduler launches the run)..." -ForegroundColor Yellow
    Set-JobPauseStatus $ctx.JobId "UNPAUSED"

    Write-Host "STARTED - continuous trigger live; clean resume, expect only the ~2-min watermark lag." -ForegroundColor Green
  }

  "status" {
    $active = az containerapp revision show -n $ctx.Producer -g $ctx.Rg --revision $ctx.Revision --query "properties.active" -o tsv
    Write-Host "producer revision active : $active"
    Write-Host "active job runs          :"
    databricks jobs list-runs --job-id $ctx.JobId --active-only
  }
}
