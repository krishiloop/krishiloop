<#
KrishiLoop on Azure Container Apps (Azure for Students). Windows PowerShell 5.1 compatible.

What it creates in one resource group:
  - a container registry; both images are built IN AZURE (az acr build), so no local Docker is needed;
  - a storage account + file share mounted at /app/data, so signed credentials and status lists survive restarts;
  - a Container Apps environment with two apps:
      api   : external HTTPS, 1 vCPU / 2 GiB, max 1 replica (the JSON trust store has one writer), min $ApiMinReplicas;
      photo : INTERNAL only, 2 vCPU / 4 GiB, scales 0..1 (the BioCLIP 2 worker; only the API can call it).
Secrets: generated here and written to D:\AI_congress\secrets\.env.azure (never printed, never committed). The issuer
key is a NEW production key, not the development one.

Run (after `az login`):  powershell -ExecutionPolicy Bypass -File infra\azure\deploy.ps1 -PublicBaseUrl https://krishiloop.vercel.app
PublicBaseUrl is the address people see (it becomes the issuer did:web and the QR links). Decide it before the first
receipt: changing it later starts a new signer identity.
#>
param(
  [Parameter(Mandatory = $true)] [string]$PublicBaseUrl,
  [string]$Location = "centralindia",
  [string]$ResourceGroup = "rg-krishiloop",
  [string]$Prefix = "krishiloop",
  [string]$ModelDir = "D:\AI_congress\models\krishilens-bioclip2-v1",
  [string]$AcrSku = "Standard",
  [int]$ApiMinReplicas = 0,
  [string]$Tag = (Get-Date -Format "yyyyMMdd-HHmm")
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SecretsFile = "D:\AI_congress\secrets\.env.azure"

function Az { param([Parameter(ValueFromRemainingArguments = $true)] $Rest) $out = & az @Rest; if ($LASTEXITCODE -ne 0) { throw "az $($Rest -join ' ') failed" }; $out }
# does a resource exist? (stderr ignored; Windows PowerShell 5.1 would otherwise turn it into a terminating error)
function Exists([scriptblock]$Cmd) { $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"; try { & $Cmd 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } finally { $ErrorActionPreference = $prev } }
function NewSecret([int]$Bytes) { $b = New-Object byte[] $Bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }

Write-Host "== 0. checks"
$sub = Az account show --query "{name:name, id:id}" -o json | ConvertFrom-Json
Write-Host "subscription: $($sub.name)"
foreach ($f in "meta.json", "text.npz", "export_report.json", "vision.onnx") { if (-not (Test-Path (Join-Path $ModelDir $f))) { throw "missing $f in $ModelDir (run ml/vision/export_backbone.py)" } }
if (-not (Test-Path $SecretsFile)) {
  # generated once; re-runs reuse them so receipts keep verifying
  "KRISHILOOP_ISSUER_SEED=$(NewSecret 32)`nADMIN_TOKEN=$(NewSecret 24)`nPHOTO_WORKER_TOKEN=$(NewSecret 24)" | Set-Content -Path $SecretsFile -Encoding ascii
  Write-Host "new production secrets written to $SecretsFile"
}
$S = @{}; Get-Content $SecretsFile | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $S[$Matches[1]] = $Matches[2] } }

Write-Host "== 1. resource group, registry, storage"
Az group create -n $ResourceGroup -l $Location -o none
$suffix = ($sub.id -replace '[^0-9a-f]', '').Substring(0, 6)
$Acr = "$($Prefix)acr$suffix"; $Sa = "$($Prefix)st$suffix"; $Env = "$Prefix-env"; $Api = "$Prefix-api"; $Photo = "$Prefix-photo"
if (-not (Exists { az acr show -n $Acr -g $ResourceGroup -o none })) { Az acr create -n $Acr -g $ResourceGroup --sku $AcrSku --admin-enabled true -o none }
if (-not (Exists { az storage account show -n $Sa -g $ResourceGroup -o none })) { Az storage account create -n $Sa -g $ResourceGroup -l $Location --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 -o none }
if (-not (Exists { az storage share-rm show --storage-account $Sa -g $ResourceGroup -n krishiloop-data -o none })) { Az storage share-rm create --storage-account $Sa -g $ResourceGroup -n krishiloop-data --quota 5 -o none }
$saKey = Az storage account keys list -n $Sa -g $ResourceGroup --query "[0].value" -o tsv
$acrUser = Az acr credential show -n $Acr --query username -o tsv
$acrPass = Az acr credential show -n $Acr --query "passwords[0].value" -o tsv

Write-Host "== 2. build both images in Azure (tag $Tag)"
$small = Join-Path $Repo "infra\docker\build-context\krishilens-small"
New-Item -ItemType Directory -Force $small | Out-Null
foreach ($f in "meta.json", "text.npz", "export_report.json") { Copy-Item (Join-Path $ModelDir $f) $small -Force }
Push-Location $Repo
try { Az acr build -r $Acr -t "krishiloop-api:$Tag" -f infra/docker/api.Dockerfile . -o none } finally { Pop-Location }
$ctx = Join-Path $env:TEMP "krishiloop-photo-context"
if (Test-Path $ctx) { Remove-Item -Recurse -Force $ctx }
New-Item -ItemType Directory -Force (Join-Path $ctx "services\vision"), (Join-Path $ctx "models\krishilens") | Out-Null
Copy-Item (Join-Path $Repo "services\__init__.py") (Join-Path $ctx "services") -Force
foreach ($f in "__init__.py", "backbone.py", "worker.py") { Copy-Item (Join-Path $Repo "services\vision\$f") (Join-Path $ctx "services\vision") -Force }
Copy-Item (Join-Path $ModelDir "*") (Join-Path $ctx "models\krishilens") -Force
Copy-Item (Join-Path $Repo "infra\docker\photo.Dockerfile") (Join-Path $ctx "Dockerfile") -Force
Az acr build -r $Acr -t "krishiloop-photo:$Tag" $ctx -o none
Remove-Item -Recurse -Force $ctx

Write-Host "== 3. Container Apps environment + data share"
if (-not (Exists { az containerapp env show -n $Env -g $ResourceGroup -o none })) { Az containerapp env create -n $Env -g $ResourceGroup -l $Location -o none }
Az containerapp env storage set -n $Env -g $ResourceGroup --storage-name kldata --azure-file-account-name $Sa --azure-file-account-key $saKey --azure-file-share-name krishiloop-data --access-mode ReadWrite -o none
$envId = Az containerapp env show -n $Env -g $ResourceGroup --query id -o tsv

Write-Host "== 4. photo worker (internal only, scales to zero)"
$server = "$Acr.azurecr.io"
if (Exists { az containerapp show -n $Photo -g $ResourceGroup -o none }) {
  Az containerapp update -n $Photo -g $ResourceGroup --image "$server/krishiloop-photo:$Tag" -o none
} else {
  Az containerapp create -n $Photo -g $ResourceGroup --environment $Env --image "$server/krishiloop-photo:$Tag" `
    --registry-server $server --registry-username $acrUser --registry-password $acrPass `
    --target-port 8001 --ingress internal --cpu 2 --memory 4Gi --min-replicas 0 --max-replicas 1 `
    --secrets "photo-token=$($S.PHOTO_WORKER_TOKEN)" --env-vars "PHOTO_WORKER_TOKEN=secretref:photo-token" -o none
}
$photoFqdn = Az containerapp show -n $Photo -g $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv

Write-Host "== 5. API (external HTTPS, persistent /app/data)"
$yaml = @"
location: $Location
properties:
  managedEnvironmentId: $envId
  configuration:
    ingress:
      external: true
      targetPort: 8000
      transport: auto
    registries:
      - server: $server
        username: $acrUser
        passwordSecretRef: acr-password
    secrets:
      - name: acr-password
        value: "$acrPass"
      - name: issuer-seed
        value: "$($S.KRISHILOOP_ISSUER_SEED)"
      - name: admin-token
        value: "$($S.ADMIN_TOKEN)"
      - name: photo-token
        value: "$($S.PHOTO_WORKER_TOKEN)"
  template:
    containers:
      - name: api
        image: $server/krishiloop-api:$Tag
        resources:
          cpu: 1.0
          memory: 2Gi
        env:
          - name: PUBLIC_BASE_URL
            value: "$PublicBaseUrl"
          - name: KRISHILOOP_ISSUER_SEED
            secretRef: issuer-seed
          - name: ADMIN_TOKEN
            secretRef: admin-token
          - name: PHOTO_WORKER_TOKEN
            secretRef: photo-token
          - name: KRISHILENS_REMOTE_URL
            value: "https://$photoFqdn"
        volumeMounts:
          - volumeName: data
            mountPath: /app/data
    scale:
      minReplicas: $ApiMinReplicas
      maxReplicas: 1
    volumes:
      - name: data
        storageType: AzureFile
        storageName: kldata
"@
$yamlFile = Join-Path $env:TEMP "krishiloop-api.yaml"
try {
  $yaml | Set-Content -Path $yamlFile -Encoding ascii
  if (Exists { az containerapp show -n $Api -g $ResourceGroup -o none }) {
    Az containerapp update -n $Api -g $ResourceGroup --yaml $yamlFile -o none
  } else {
    Az containerapp create -n $Api -g $ResourceGroup --yaml $yamlFile -o none
  }
} finally { Remove-Item -Force $yamlFile -ErrorAction SilentlyContinue }   # the file held secrets
$apiFqdn = Az containerapp show -n $Api -g $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv

Write-Host ""
Write-Host "== done"
Write-Host "API (direct):      https://$apiFqdn   (health: https://$apiFqdn/health)"
Write-Host "Photo worker:      internal only ($photoFqdn)"
Write-Host "Public address:    $PublicBaseUrl   (point the website's rewrites at https://$apiFqdn)"
Write-Host "Next: infra\vercel\deploy.ps1 -ApiUrl https://$apiFqdn"
Write-Host "Reminder: set the budget alert (plan\AZURE_SETUP_GUIDE.md, step 2) if it is not set yet."
