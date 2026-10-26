<# 用 Windows 原生 Python 虚拟环境启动 DSH 后端；支持不同安装渠道，不依赖 WSL。 #>
[CmdletBinding()]
param(
    [string]$Python,
    [string]$Workspace,
    [string]$DataDirectory = (Join-Path $env:USERPROFILE '.rvguarder\dsh-rc3-dev'),
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$Profile = 'rvguarder-dev',
    [string]$Instance = 'dsh-rc3-dev',
    [int]$Port = 8781,
    [ValidateSet('local','auto','llm')][string]$SemanticMode = 'local',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!$Workspace) { $Workspace = $repo }
$Workspace = [IO.Path]::GetFullPath($Workspace)
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$DshHome = [IO.Path]::GetFullPath($DshHome)
if (!(Test-Path -LiteralPath $Workspace -PathType Container)) { throw "Workspace must already exist: $Workspace" }
if (!$Python) {
    $Python = Join-Path $repo '.venv\bin\python.exe'
    if (!(Test-Path -LiteralPath $Python)) { $Python = Join-Path $repo '.venv\Scripts\python.exe' }
}
if (!(Test-Path -LiteralPath $Python)) { throw 'Prepare the project Python environment first; see docs/windows-native-rc3.md.' }
$arguments = @('-X','utf8','-m','clawRVguarder.hosts.dsh.server',
    '--project-dir',$DataDirectory,'--dsh-home',$DshHome,'--workspace',$Workspace,
    '--profile',$Profile,'--instance-id',$Instance,'--port',"$Port",'--semantic-mode',$SemanticMode)
if ($PrepareOnly) { $arguments += '--prepare-only' }
Push-Location $repo
try {
    & $Python @arguments
    if ($LASTEXITCODE -ne 0) { throw "DSH backend exited with code $LASTEXITCODE" }
} finally { Pop-Location }
