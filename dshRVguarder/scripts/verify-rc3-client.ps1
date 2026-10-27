# 验证客户端 bundle 进入宿主 boot graph 并可被拉取。
param(
    [string]$DshCli = 'C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd',
    [string]$Stage = (Join-Path $PSScriptRoot '..\..\runtime\native-rc3-ui-verify')
)
$ErrorActionPreference = 'Stop'
$workspace = Join-Path $Stage 'workspace'
$dshHome = Join-Path $Stage 'home'
$env:DSH_HOME = $dshHome
$hostProc = Start-Process -FilePath $DshCli -ArgumentList @('--profile','rvguarder-ui','--no-open','--port','8791') `
    -WorkingDirectory $workspace -PassThru -RedirectStandardOutput (Join-Path $Stage 'dbg.out.log') -RedirectStandardError (Join-Path $Stage 'dbg.err.log')
try {
    $launchToken = $null
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not $launchToken) {
        if ($hostProc.HasExited) { break }
        $out = (Get-Content (Join-Path $Stage 'dbg.out.log') -Raw -ErrorAction SilentlyContinue) + (Get-Content (Join-Path $Stage 'dbg.err.log') -Raw -ErrorAction SilentlyContinue)
        if ($out -match 'token=([A-Za-z0-9_\-\.]+)') { $launchToken = $Matches[1] }
        Start-Sleep -Milliseconds 500
    }
    if (-not $launchToken) { throw 'no token' }
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try { Invoke-WebRequest -Uri "http://127.0.0.1:8791/connect?token=$launchToken" -WebSession $session -Method GET -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop | Out-Null } catch { }
    Start-Sleep -Seconds 3
    $page = Invoke-WebRequest -Uri "http://127.0.0.1:8791/?token=$launchToken" -WebSession $session -Method GET -UseBasicParsing
    $html = $page.Content
    $hasRvg = $html -match 'dsh-rvguarder/client\.js'
    Write-Host "boot graph includes dsh-rvguarder client: $hasRvg"
    if ($hasRvg) {
        # 拉取该客户端 bundle（combo URL）
        if ($html -match 'plugins/\?\?dsh-rvguarder/client\.js[^"\\'']+') {
            $rel = $Matches[0]
            Write-Host "bundle url: $rel"
            $bundle = Invoke-WebRequest -Uri "http://127.0.0.1:8791/$($rel -replace '&amp;','&')" -WebSession $session -Method GET -UseBasicParsing
            Write-Host ("client bundle bytes: " + $bundle.Content.Length)
            Write-Host ("client bundle registers: " + ($bundle.Content -match '__ModuleLoader__\.load'))
        } else { Write-Host 'WARN: combo url pattern not found' }
    }
} finally {
    taskkill /PID $hostProc.Id /T /F 2>$null | Out-Null
    Start-Sleep -Seconds 2
}
