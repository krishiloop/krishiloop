<#
KrishiLoop website on Vercel (free Hobby plan), deployed from this laptop with the Vercel CLI.

Why the CLI: Vercel's Hobby plan cannot deploy a PRIVATE repository owned by a GitHub organization (ours is), but a CLI
deploy uploads the local folder and works. Once the repo is public at the freeze, Git deploys also work.

The site and the API look like one address to the browser: /api, /status, /.well-known and /health are rewritten to the
Azure API, so receipts' QR links, the did:web document and the verifier all live on the public address.

Run (after `npx vercel login` once):
  powershell -ExecutionPolicy Bypass -File infra\vercel\deploy.ps1 -ApiUrl https://krishiloop-api.<region>.azurecontainerapps.io
#>
param(
  [Parameter(Mandatory = $true)] [string]$ApiUrl,
  [string]$Project = "krishiloop",
  [string]$VercelVersion = "64.0.2"
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Web = Join-Path $Repo "apps\web"
$api = $ApiUrl.TrimEnd("/")
if ($api -notmatch '^https://') { throw "ApiUrl must start with https://" }

(Get-Content (Join-Path $PSScriptRoot "vercel.template.json") -Raw).Replace("__API_URL__", $api) |
  Set-Content -Path (Join-Path $Web "vercel.json") -Encoding ascii
Write-Host "apps/web/vercel.json now forwards /api, /status, /.well-known and /health to $api"

Push-Location $Web
try {
  & npx --yes "vercel@$VercelVersion" link --yes --project $Project
  if ($LASTEXITCODE -ne 0) { throw "vercel link failed (did you run npx vercel login?)" }
  & npx --yes "vercel@$VercelVersion" deploy --prod --yes
  if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed" }
} finally { Pop-Location }
Write-Host "Done. Check: <your vercel URL>/health and <your vercel URL>/.well-known/did.json both answer from the API."
