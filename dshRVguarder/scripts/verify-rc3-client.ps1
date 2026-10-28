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
    -WorkingDirectory $workspace -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Stage 'dbg.out.log') -RedirectStandardError (Join-Path $Stage 'dbg.err.log')
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
    Start-Sleep -Seconds 3
    & node (Join-Path $PSScriptRoot 'verify-boot.mjs') --url 'http://127.0.0.1:8791' --log (Join-Path $Stage 'dbg.out.log') --output (Join-Path $Stage 'client-result.json')
    if ($LASTEXITCODE -ne 0) { throw 'Authenticated client boot graph verification failed.' }
} finally {
    taskkill /PID $hostProc.Id /T /F 2>$null | Out-Null
    Start-Sleep -Seconds 2
}
