#Requires -Version 5.1
<#
.SYNOPSIS
  Fast Garbona deploy to VPS.

.PARAMETER Mode
  quick     - git changed files + restart, NO .env; falls back to full without a Git working tree
  full      - full tarball via vps-deploy-app.sh, NO .env
  env       - .env only + restart
  with-env  - quick + .env; falls back to full-env without a Git working tree
  full-env  - full + .env
  restart   - pm2 restart only
  status    - pm2 status / logs
  files     - explicit list: -Files "src\a.js,panel\js\app.js"

.EXAMPLE
  .\scripts\deploy-vps.ps1 quick
  .\scripts\deploy-vps.ps1 with-env
  .\scripts\deploy-vps.ps1 files -Files "src\panel\routes.js,panel\js\app.js"
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("quick", "full", "env", "with-env", "full-env", "restart", "status", "files", "diag-discord", "npm-install", "menu")]
  [string]$Mode = "menu",

  [string]$Files = "",

  [switch]$NoRestart,
  [switch]$IncludeEnv,
  [switch]$SkipNpm
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  throw "package.json not found in $Root"
}

function Load-DeployConfig {
  $cfgPath = Join-Path $PSScriptRoot "deploy-vps.env"
  if (Test-Path $cfgPath) {
    Get-Content $cfgPath -Encoding UTF8 | ForEach-Object {
      $line = $_.Trim()
      if (-not $line -or $line.StartsWith("#")) { return }
      if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") { return }
      $name = $Matches[1]
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        Set-Item -Path "Env:$name" -Value $value
      }
    }
  }

  $script:HostName = if ($env:DEPLOY_VPS_HOST) { $env:DEPLOY_VPS_HOST } else { "89.125.168.146" }
  $script:Port = if ($env:DEPLOY_VPS_PORT) { [int]$env:DEPLOY_VPS_PORT } else { 22 }
  $script:User = if ($env:DEPLOY_VPS_USER) { $env:DEPLOY_VPS_USER } else { "root" }
  $script:Remote = if ($env:DEPLOY_VPS_REMOTE) { $env:DEPLOY_VPS_REMOTE.TrimEnd("/") } else { "/opt/garbona" }
  $script:Pm2Name = if ($env:DEPLOY_VPS_PM2) { $env:DEPLOY_VPS_PM2 } else { "garbona-bot" }
  $script:UseOpenSsh = $env:DEPLOY_VPS_USE_OPENSSH -eq "1"
  $script:Password = $env:DEPLOY_VPS_PASSWORD
}

function Ensure-Password {
  if ($script:UseOpenSsh) { return }
  if ($script:Password) { return }
  $secure = Read-Host "VPS password ($($script:User)@$($script:HostName))" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $script:Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if (-not $script:Password) { throw "Empty password" }
}

function Get-SshCredential {
  Ensure-Password
  $sec = ConvertTo-SecureString $script:Password -AsPlainText -Force
  return New-Object System.Management.Automation.PSCredential($script:User, $sec)
}

function Ensure-PoshSsh {
  if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    throw "Posh-SSH required. Run: Install-Module Posh-SSH -Scope CurrentUser"
  }
  Import-Module Posh-SSH -ErrorAction Stop
  # Suppress noisy "Host key is not being verified..." on every Set-SCPItem
  $script:PrevWarningPreference = $WarningPreference
  $WarningPreference = "SilentlyContinue"
  Get-SSHSession | Remove-SSHSession | Out-Null
}

function Invoke-Remote {
  param([string]$Command, [int]$TimeoutSec = 180)
  if ($script:UseOpenSsh) {
    $target = "$($script:User)@$($script:HostName)"
    $args = @("-p", "$($script:Port)", "-o", "StrictHostKeyChecking=accept-new", $target, $Command)
    $out = & ssh @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "ssh failed: $out" }
    return ($out | Out-String)
  }

  Ensure-PoshSsh
  $cred = Get-SshCredential
  $session = New-SSHSession -ComputerName $script:HostName -Port $script:Port -Credential $cred -AcceptKey -Force -ConnectionTimeout 30
  if (-not $session) { throw "SSH session failed" }
  try {
    $r = Invoke-SSHCommand -SessionId $session.SessionId -TimeOut $TimeoutSec -Command $Command
    if ($r.ExitStatus -ne 0) {
      throw "Remote exit=$($r.ExitStatus)`n$($r.Output)`n$($r.Error)"
    }
    return [string]$r.Output
  } finally {
    Remove-SSHSession -SessionId $session.SessionId | Out-Null
  }
}

function Upload-File {
  param(
    [Parameter(Mandatory = $true)][string]$LocalPath,
    [Parameter(Mandatory = $true)][string]$RemoteDir
  )
  if (-not (Test-Path -LiteralPath $LocalPath)) {
    throw "Missing file: $LocalPath"
  }
  $RemoteDir = $RemoteDir.Replace("\", "/").TrimEnd("/")

  if ($script:UseOpenSsh) {
    $target = "$($script:User)@$($script:HostName):$RemoteDir/"
    & ssh -p $script:Port -o StrictHostKeyChecking=accept-new "$($script:User)@$($script:HostName)" "mkdir -p '$RemoteDir'" | Out-Null
    & scp -P $script:Port -o StrictHostKeyChecking=accept-new $LocalPath $target
    if ($LASTEXITCODE -ne 0) { throw "scp failed: $LocalPath" }
    return
  }

  Ensure-PoshSsh
  $cred = Get-SshCredential
  Invoke-Remote "mkdir -p '$RemoteDir'" | Out-Null
  Set-SCPItem -ComputerName $script:HostName -Port $script:Port -Credential $cred -AcceptKey -Force -Path $LocalPath -Destination $RemoteDir
}

function Normalize-LocalRel {
  param([string]$Path)
  $full = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $Root $Path }
  $full = [IO.Path]::GetFullPath($full)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "File outside repo: $Path"
  }
  $rel = $full.Substring($rootFull.Length).TrimStart([char[]]@("\", "/"))
  return @{
    Full = $full
    Rel = ($rel -replace "\\", "/")
    RelWin = $rel
  }
}

function Is-EnvRel {
  param([string]$Rel)
  $r = ($Rel -replace "\\", "/").Trim().TrimStart("/")
  return $r -eq ".env"
}

function Should-SkipRel {
  param([string]$Rel)
  $r = $Rel.ToLowerInvariant() -replace "\\", "/"
  if ($r -match '(^|/)node_modules(/|$)') { return $true }
  if ($r -match '(^|/)\.git(/|$)') { return $true }
  if ($r -match '(^|/)\.vs(/|$)') { return $true }
  if ($r -match '\.(tgz|zip|7z|rar)$') { return $true }
  if ($r -match '(^|/)deploy-vps\.env$') { return $true }
  if (Is-EnvRel $Rel) { return $true }
  return $false
}

function Test-GitWorkingTree {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }

  try {
    $inside = & git -C $Root rev-parse --is-inside-work-tree 2>$null
    return $LASTEXITCODE -eq 0 -and ($inside | Select-Object -First 1) -eq "true"
  } catch {
    return $false
  }
}

function Get-ChangedRels {
  if (-not (Test-GitWorkingTree)) {
    throw "Quick deploy requires a Git working tree. Use full deploy for folders without .git."
  }

  Push-Location $Root
  try {
    $out = @()
    $out += git status --porcelain --untracked-files=all 2>$null
    $rels = New-Object System.Collections.Generic.HashSet[string]
    foreach ($line in $out) {
      if (-not $line) { continue }
      $path = $line.Substring(3).Trim()
      if ($path -match " -> ") { $path = ($path -split " -> ")[-1] }
      $path = $path.Trim('"')
      if (-not $path) { continue }
      $info = Normalize-LocalRel $path
      if (Should-SkipRel $info.Rel) { continue }
      if (-not (Test-Path -LiteralPath $info.Full -PathType Leaf)) { continue }
      [void]$rels.Add($info.Rel)
    }
    return @($rels)
  } finally {
    Pop-Location
  }
}

$script:TextExtensions = @(
  ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".jsonc",
  ".html", ".htm", ".css", ".scss", ".svg", ".xml", ".yml", ".yaml",
  ".md", ".txt", ".sh", ".env", ".conf", ".cfg", ".ini", ".sql"
)

function Is-TextRel {
  param([string]$Rel)
  $ext = [IO.Path]::GetExtension($Rel).ToLowerInvariant()
  if (-not $ext) { return $false }
  return $script:TextExtensions -contains $ext
}

# Line endings are normalized remotely because Windows checkouts carry CRLF.
# Binary assets (PNG, fonts, archives) must never pass through this rewrite:
# a stray 0x0D byte inside them would be dropped and silently corrupt the file.
function Strip-CrlfRemote {
  param([string[]]$RemoteRels)
  if (-not $RemoteRels) { return }
  $RemoteRels = @($RemoteRels | Where-Object { Is-TextRel $_ })
  if (-not $RemoteRels.Count) { return }
  $joined = ($RemoteRels | ForEach-Object { $_.Replace("\", "/") }) -join "|"
  $escaped = $joined.Replace("'", "'\''")
  $cmd = "python3 -c `"import pathlib; root=pathlib.Path('$($script:Remote)'); rels='$escaped'.split('|');
[print('crlf', r) or p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')) for r in rels if r and (p:=root/r).is_file() and (b'\r' in p.read_bytes())]`""
  # Simpler portable fallback:
  $cmd = @"
python3 -c 'import pathlib; root=pathlib.Path("$($script:Remote)"); rels="""$escaped""".split("|");
for r in rels:
 r=r.strip().replace("\\\\","/");
 if not r: continue
 p=root/r
 if not p.is_file(): continue
 data=p.read_bytes()
 if b"\r" in data: p.write_bytes(data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")); print("crlf", r)'
"@
  try { Invoke-Remote $cmd | Out-Null } catch { Write-Host "CRLF strip skipped: $_" -ForegroundColor Yellow }
}

function Upload-Rels {
  param([string[]]$Rels, [switch]$AllowEnv)
  $toUpload = @()
  foreach ($rel in $Rels) {
    $info = Normalize-LocalRel $rel
    $isEnv = Is-EnvRel $info.Rel
    if (-not $AllowEnv -and $isEnv) {
      Write-Host "skip .env (no-env mode)" -ForegroundColor Yellow
      continue
    }
    if ((Should-SkipRel $info.Rel) -and -not ($AllowEnv -and $isEnv)) { continue }
    if (-not (Test-Path -LiteralPath $info.Full -PathType Leaf)) { continue }
    $toUpload += $info
  }
  if (-not $toUpload.Count) { return @() }

  # 1 file: direct scp. Many files: one small tar (Posh-SSH per-file is very slow).
  if ($toUpload.Count -eq 1) {
    $info = $toUpload[0]
    $parent = Split-Path $info.Rel -Parent
    $remoteDir = if ([string]::IsNullOrWhiteSpace($parent)) {
      $script:Remote
    } else {
      "$($script:Remote)/$($parent.Replace('\','/'))"
    }
    Write-Host "up $($info.Rel)" -ForegroundColor Cyan
    Upload-File -LocalPath $info.Full -RemoteDir $remoteDir
    Strip-CrlfRemote @($info.Rel)
    return @($info.Rel)
  }

  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw "tar required for multi-file quick deploy"
  }

  $tmp = Join-Path $env:TEMP ("garbona-quick-" + [guid]::NewGuid().ToString("n") + ".tgz")
  $listFile = Join-Path $env:TEMP ("garbona-quick-" + [guid]::NewGuid().ToString("n") + ".txt")
  try {
    $rels = @($toUpload | ForEach-Object { $_.Rel })
    # tar on Windows expects forward slashes in -T list files; backslashes become literal path chars on Linux extract.
    ($rels -replace "\\", "/") | Set-Content -Path $listFile -Encoding ascii
    Write-Host ("packing {0} files..." -f $rels.Count) -ForegroundColor Cyan
    Push-Location $Root
    try {
      & tar -czf $tmp -T $listFile
      if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }
    } finally {
      Pop-Location
    }
    $kb = [math]::Round((Get-Item $tmp).Length / 1KB, 1)
    Write-Host "upload patch ($kb KB)..." -ForegroundColor Cyan
    Upload-File -LocalPath $tmp -RemoteDir "/tmp"
    $remoteTar = "/tmp/" + [IO.Path]::GetFileName($tmp)
    $cmd = "set -e; cd $($script:Remote); tar -xzf $remoteTar; rm -f $remoteTar; echo QUICK_EXTRACT_OK"
    Write-Host (Invoke-Remote $cmd -TimeoutSec 120)
    Strip-CrlfRemote $rels
    return $rels
  } finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    if (Test-Path $listFile) { Remove-Item $listFile -Force -ErrorAction SilentlyContinue }
  }
}

function Restart-App {
  if ($NoRestart) {
    Write-Host "restart skipped" -ForegroundColor Yellow
    return
  }
  Write-Host "pm2 restart $($script:Pm2Name)..." -ForegroundColor Cyan
  $out = Invoke-Remote "pm2 restart $($script:Pm2Name) --update-env && sleep 1 && pm2 describe $($script:Pm2Name) | grep -E 'status|uptime|restarts' | head -8"
  Write-Host $out
}

function Install-RemoteNpm {
  Write-Host "npm install on VPS..." -ForegroundColor Cyan
  $out = Invoke-Remote "cd $($script:Remote) && npm install --omit=dev" -TimeoutSec 600
  Write-Host $out
}

function Show-Status {
  $out = Invoke-Remote "pm2 describe $($script:Pm2Name) | grep -E 'status|uptime|restarts|script path' | head -12; echo '--- logs ---'; pm2 logs $($script:Pm2Name) --lines 40 --nostream | tail -50; echo '--- error tail ---'; tail -30 $($script:Remote)/logs/pm2-error.log 2>/dev/null || true"
  Write-Host $out
}

function Show-DiscordDiag {
  $cmd = 'cd ' + $script:Remote + '; echo --- discord env ---; grep -E "^DISCORD_|^TOKEN_DISCORD" .env 2>/dev/null | sed "s/=.*/=***/" || echo no discord keys; echo --- discord code ---; ls -la src/discord 2>/dev/null || echo src/discord missing; test -f src/discord/index.js && echo src/discord/index.js OK || echo MISSING src/discord/index.js; grep -n startDiscordBot src/index.js 2>/dev/null | head -3 || echo no startDiscordBot; echo --- discord.js package ---; test -d node_modules/discord.js && echo discord.js OK || echo MISSING discord.js; echo --- recent startup ---; grep -E "Bot polling|Discord bot|Discord login|Discord bot skipped|Discord bot failed|Bot launch" logs/pm2-out.log logs/pm2-error.log 2>/dev/null | tail -20 || echo no startup lines'
  Write-Host (Invoke-Remote $cmd -TimeoutSec 120)
}

function Build-WorkerDashboard {
  Write-Host "building worker dashboard..." -ForegroundColor Cyan
  Push-Location $Root
  try {
    & npm run build:worker-dashboard
    if ($LASTEXITCODE -ne 0) {
      throw "worker dashboard build failed"
    }
  } finally {
    Pop-Location
  }
}

function Deploy-Full {
  param([switch]$WithEnv)
  Write-Host "=== FULL deploy ===" -ForegroundColor Green
  $tmp = Join-Path $env:TEMP "deploy-garbona.tgz"
  if (Test-Path $tmp) { Remove-Item $tmp -Force }

  Push-Location $Root
  try {
    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
      throw "tar required (Windows 10+ / Git)"
    }
    & tar -czf $tmp --exclude=node_modules --exclude=.git --exclude=logs --exclude=*.tgz --exclude=*.log --exclude=scripts/deploy-vps.env --exclude=.env --exclude=.vs .
  } finally {
    Pop-Location
  }

  $mb = [math]::Round((Get-Item $tmp).Length / 1MB, 1)
  Write-Host "upload tarball ($mb MB)..." -ForegroundColor Cyan
  Upload-File -LocalPath $tmp -RemoteDir "/tmp"
  if ($WithEnv) {
    Upload-Rels -Rels @(".env") -AllowEnv | Out-Null
  }

  $deploySh = Join-Path $Root "scripts\vps-deploy-app.sh"
  Upload-File -LocalPath $deploySh -RemoteDir "/tmp"

  if ($SkipNpm) {
    Write-Host "SkipNpm: unpack + restart only" -ForegroundColor Yellow
    $cmd = "set -e; cd $($script:Remote); tar -xzf /tmp/deploy-garbona.tgz; pm2 restart $($script:Pm2Name); sleep 1; pm2 describe $($script:Pm2Name) | grep -E 'status|uptime|restarts' | head -8; echo APP_QUICK_FULL_OK"
  } else {
    $cmd = "set -e; sed -i 's/\r`$//' /tmp/vps-deploy-app.sh; chmod +x /tmp/vps-deploy-app.sh; bash /tmp/vps-deploy-app.sh"
  }
  Write-Host (Invoke-Remote $cmd -TimeoutSec 600)
}

function Show-Menu {
  Write-Host ""
  Write-Host "Garbona deploy -> $($script:User)@$($script:HostName):$($script:Remote)" -ForegroundColor Green
  Write-Host "  1) quick      - git changes, no .env (full fallback without .git)"
  Write-Host "  2) with-env   - git changes + .env (full-env fallback without .git)"
  Write-Host "  3) env        - .env only"
  Write-Host "  4) full       - full tar, no .env"
  Write-Host "  5) full-env   - full tar + .env"
  Write-Host "  6) restart    - pm2 restart"
  Write-Host "  7) status     - pm2 status/logs"
  Write-Host "  0) exit"
  Write-Host ""
  $choice = Read-Host "Choice"
  switch ($choice) {
    "1" { return "quick" }
    "2" { return "with-env" }
    "3" { return "env" }
    "4" { return "full" }
    "5" { return "full-env" }
    "6" { return "restart" }
    "7" { return "status" }
    default { return "exit" }
  }
}

Load-DeployConfig

if ($Mode -eq "menu") {
  $Mode = Show-Menu
  if ($Mode -eq "exit") { return }
}

if ($Mode -in @("quick", "with-env") -and -not (Test-GitWorkingTree)) {
  $requestedMode = $Mode
  $Mode = if ($requestedMode -eq "with-env") { "full-env" } else { "full" }
  Write-Host "Git working tree not found in $Root." -ForegroundColor Yellow
  Write-Host "Switching $requestedMode -> $Mode so the deployment includes all local changes." -ForegroundColor Yellow
}

if ($Mode -in @("quick", "with-env", "full", "full-env", "files")) {
  Build-WorkerDashboard
}

$wantEnv = $IncludeEnv -or $Mode -in @("env", "with-env", "full-env")
Write-Host "Mode=$Mode Host=$($script:HostName) Remote=$($script:Remote) Env=$wantEnv" -ForegroundColor Green

switch ($Mode) {
  "status" {
    Ensure-Password
    Show-Status
  }
  "diag-discord" {
    Ensure-Password
    Show-DiscordDiag
  }
  "npm-install" {
    Ensure-Password
    Install-RemoteNpm
    Restart-App
  }
  "restart" {
    Ensure-Password
    Restart-App
  }
  "env" {
    Ensure-Password
    if (-not (Test-Path (Join-Path $Root ".env"))) { throw "Local .env missing" }
    Upload-Rels -Rels @(".env") -AllowEnv | Out-Null
    Restart-App
  }
  "quick" {
    Ensure-Password
    $rels = @(Get-ChangedRels)
    foreach ($forced in @(
      "panel/worker/assets/logo.png",
      "panel/worker/assets/logo.svg",
      "panel/worker/assets/dashboard/dashboard.css",
      "panel/worker/assets/dashboard/dashboard.js"
    )) {
      if (Test-Path (Join-Path $Root $forced)) {
        $rels += $forced
      }
    }
    $rels = @($rels | Select-Object -Unique)
    if (-not $rels.Count) {
      Write-Host "No changed files (git status empty)." -ForegroundColor Yellow
      break
    }
    Write-Host "Files: $($rels.Count)" -ForegroundColor Cyan
    Upload-Rels -Rels $rels | Out-Null
    Restart-App
  }
  "with-env" {
    Ensure-Password
    $rels = @(Get-ChangedRels)
    if (Test-Path (Join-Path $Root ".env")) { $rels = @($rels + ".env") | Select-Object -Unique }
    if (-not $rels.Count) { throw "Nothing to upload" }
    Upload-Rels -Rels $rels -AllowEnv | Out-Null
    Restart-App
  }
  "full" {
    Ensure-Password
    Deploy-Full
  }
  "full-env" {
    Ensure-Password
    Deploy-Full -WithEnv
  }
  "files" {
    Ensure-Password
    if (-not $Files) { throw "Use -Files path1,path2" }
    $rels = @($Files.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $rels += @(
      "panel/worker/assets/dashboard/dashboard.css",
      "panel/worker/assets/dashboard/dashboard.js"
    )
    $rels = @($rels | Select-Object -Unique)
    Upload-Rels -Rels $rels -AllowEnv:$wantEnv | Out-Null
    Restart-App
  }
  default { throw "Unknown mode: $Mode" }
}

Write-Host "DONE" -ForegroundColor Green
