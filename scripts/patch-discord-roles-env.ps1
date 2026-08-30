#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$cfgPath = Join-Path $PSScriptRoot "deploy-vps.env"
if (Test-Path $cfgPath) {
  Get-Content $cfgPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") { return }
    Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim().Trim('"').Trim("'")
  }
}

$HostName = if ($env:DEPLOY_VPS_HOST) { $env:DEPLOY_VPS_HOST } else { "89.125.168.146" }
$Port = if ($env:DEPLOY_VPS_PORT) { [int]$env:DEPLOY_VPS_PORT } else { 22 }
$User = if ($env:DEPLOY_VPS_USER) { $env:DEPLOY_VPS_USER } else { "root" }
$Remote = if ($env:DEPLOY_VPS_REMOTE) { $env:DEPLOY_VPS_REMOTE.TrimEnd("/") } else { "/opt/garbona" }

if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
  throw "Posh-SSH required"
}
Import-Module Posh-SSH -ErrorAction Stop | Out-Null

$password = $env:DEPLOY_VPS_PASSWORD
if (-not $password) { throw "DEPLOY_VPS_PASSWORD missing in scripts/deploy-vps.env" }
$sec = ConvertTo-SecureString $password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($User, $sec)

$session = New-SSHSession -ComputerName $HostName -Port $Port -Credential $cred -AcceptKey -Force -ConnectionTimeout 30
if (-not $session) { throw "SSH session failed" }

$cmd = @"
python3 - <<'PY'
from pathlib import Path
p = Path('$Remote/.env')
lines = p.read_text(encoding='utf-8').splitlines() if p.exists() else []
vals = {
    'DISCORD_UNVERIFIED_ROLE_ID': '1094271461528715496',
    'DISCORD_VERIFIED_ROLE_ID': '1540851475910234143',
}
out, seen = [], set()
for line in lines:
    key = line.split('=', 1)[0].strip() if '=' in line else ''
    if key in vals:
        out.append(f'{key}={vals[key]}')
        seen.add(key)
    else:
        out.append(line)
for key, val in vals.items():
    if key not in seen:
        out.append(f'{key}={val}')
p.write_text('\\n'.join(out) + '\\n', encoding='utf-8')
print('ENV_ROLE_IDS_OK')
PY
pm2 restart garbona-bot --update-env
"@

try {
  $r = Invoke-SSHCommand -SessionId $session.SessionId -TimeOut 120 -Command $cmd
  Write-Host $r.Output
  if ($r.ExitStatus -ne 0) { throw "Remote failed: $($r.Error)" }
} finally {
  Remove-SSHSession -SessionId $session.SessionId | Out-Null
}

Write-Host "DONE"
