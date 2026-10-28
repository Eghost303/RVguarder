param([switch]$NoOpen, [int]$Port = 0)
$ErrorActionPreference = 'Stop'

# 项目宿主开发统一使用用户目录中的 rvguarder-dev profile。
$developmentHome = Join-Path $env:USERPROFILE '.dsh'
$developmentProfile = Join-Path $developmentHome 'profiles/rvguarder-dev'
if (-not (Test-Path -LiteralPath (Join-Path $developmentProfile 'package.json'))) {
    throw 'Install RVguarder into ~/.dsh/profiles/rvguarder-dev first.'
}
$developmentWorkspace = Join-Path $developmentHome 'workspaces/rvguarder-dev'
New-Item -ItemType Directory -Path $developmentWorkspace -Force | Out-Null
$cliCommand = Get-Command dsh.cmd -ErrorAction SilentlyContinue
$cliPath = if ($cliCommand) { $cliCommand.Source } else {
    Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'
}
if (-not (Test-Path -LiteralPath $cliPath)) { throw 'DSH CLI was not found.' }
$previousDshHome = $env:DSH_HOME
Push-Location $developmentWorkspace
try {
    $env:DSH_HOME = $developmentHome
    $cliArguments = @('--profile', 'rvguarder-dev', '--port', [string]$Port)
    if ($NoOpen) { $cliArguments += '--no-open' }
    & $cliPath @cliArguments
    $developmentExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $env:DSH_HOME = $previousDshHome
}
exit $developmentExitCode
