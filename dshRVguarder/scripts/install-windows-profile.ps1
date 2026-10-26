<# 为当前已安装的 DSH 新建独立测试 profile；拒绝覆盖已有 profile。 #>
[CmdletBinding()]
param(
    [string]$DshCli = (Get-Command dsh.cmd -ErrorAction Stop).Source,
    [string]$Python,
    [string]$Workspace,
    [string]$Package,
    [string]$DataDirectory = (Join-Path $env:USERPROFILE '.rvguarder\dsh-rc3-dev'),
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$Profile = 'rvguarder-dev',
    [string]$Instance = 'dsh-rc3-dev',
    [int]$Port = 8781
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!$Workspace) { $Workspace = $repo }
if (!$Package) { $Package = Join-Path $repo 'dshRVguarder\dsh-rvguarder-0.2.0-rc.2.tgz' }
$Package = [IO.Path]::GetFullPath($Package)
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$DshHome = [IO.Path]::GetFullPath($DshHome)
if (!(Test-Path -LiteralPath $Package)) { throw 'Build the matching plugin tgz with npm pack first.' }
if ($Profile -notmatch '^[a-zA-Z0-9_.-]{1,128}$' -or $Profile -in @('web','desktop','.','..')) { throw 'Use a new dedicated test profile name.' }
$profilePath = Join-Path $DshHome "profiles\$Profile"
if (Test-Path -LiteralPath $profilePath) { throw "Refusing to overwrite profile: $profilePath" }
$version = (& $DshCli --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notin @('0.2.1-rc.2','0.2.1-rc.3')) { throw "Unsupported DSH CLI: $version" }
& (Join-Path $PSScriptRoot 'start-windows-backend.ps1') -Python $Python -Workspace $Workspace `
    -DataDirectory $DataDirectory -DshHome $DshHome -Profile $Profile -Instance $Instance -Port $Port -PrepareOnly
& node (Join-Path $PSScriptRoot 'create-test-profile.mjs') --profile $Profile --instance $Instance `
    --token (Join-Path $DataDirectory 'runtime\dsh-token') --backend "http://127.0.0.1:$Port" --home $DshHome `
    --state (Join-Path $DataDirectory 'runtime\plugin-state')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the test profile.' }
$previousHome = $env:DSH_HOME
Push-Location $DataDirectory
try {
    $env:DSH_HOME = $DshHome
    & $DshCli plugin --profile $Profile add --store-dir (Join-Path $DataDirectory 'runtime\pnpm-store') $Package
    if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed; preserve the new profile for diagnosis.' }
} finally {
    $env:DSH_HOME = $previousHome
    Pop-Location
}
Write-Host "Installed DSH $version profile $Profile. Start the backend, then run dsh --profile $Profile from your workspace."
