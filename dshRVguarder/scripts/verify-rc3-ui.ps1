param(
    [string]$DshCli = 'C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd',
    [string]$Package,
    [string]$Output = (Join-Path $PSScriptRoot '..\..\runtime\native-rc3-ui-verify')
)
# 真实 rc.3 宿主验证：安装 bundle 化插件 → 启动 web profile → 认证 →
# 通过 /api RPC 验证插件清单与管理通道。产物在 runtime/native-rc3-ui-verify/。
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!$Package) { $Package = Join-Path $repo ("dshRVguarder\dsh-rvguarder-" + (Get-Content (Join-Path $repo 'dshRVguarder\package.json') -Raw | ConvertFrom-Json).version + '.tgz') }
$python = Join-Path $repo '.venv\bin\python.exe'
if (!(Test-Path $python)) { $python = Join-Path $repo '.venv\Scripts\python.exe' }
$stage = [IO.Path]::GetFullPath($Output)
if (Test-Path $stage) { throw "stage exists: $stage" }
$workspace = Join-Path $stage 'workspace'
$dshHome = Join-Path $stage 'home'
$temp = Join-Path $stage 'temp'
$project = Join-Path $stage 'guard'
New-Item -ItemType Directory -Path $workspace, $temp | Out-Null
$env:DSH_HOME = $dshHome
$env:TEMP = $temp
$env:TMP = $temp
$env:PYTHONUTF8 = '1'
$port = 8791
$report = @{}

function Stop-Tree([int]$Id) {
    if ($Id -le 0) { return }
    taskkill /PID $Id /T /F 2>$null | Out-Null
}

# 1) 后端 --prepare-only 生成实例与令牌
$backendProc = Start-Process -FilePath $python -ArgumentList @('-X','utf8','-m','clawRVguarder.hosts.dsh.server',
    '--project-dir', $project, '--dsh-home', $dshHome, '--workspace', $workspace,
    '--profile', 'rvguarder-ui', '--instance-id', 'rc3-ui', '--port', '0', '--semantic-mode', 'local', '--prepare-only') `
    -WorkingDirectory $repo -PassThru -RedirectStandardOutput (Join-Path $stage 'prepare.out.log') -RedirectStandardError (Join-Path $stage 'prepare.err.log') -NoNewWindow
Wait-Process -Id $backendProc.Id -Timeout 90 -ErrorAction SilentlyContinue
$tokenFile = Join-Path $project 'runtime\dsh-token'
if (!(Test-Path $tokenFile)) { throw 'prepare-only failed: no token' }
$token = (Get-Content $tokenFile -Raw).Trim()

# 2) 生成 bundle 化测试 profile（覆盖两行 config；后端固定 8785）
node (Join-Path $PSScriptRoot 'create-test-profile.mjs') --profile rvguarder-ui --instance rc3-ui `
    --token $tokenFile --backend "http://127.0.0.1:8785" --home $dshHome --state (Join-Path $project 'runtime\plugin-state')
if ($LASTEXITCODE -ne 0) { throw 'profile creation failed' }

# 3) 安装 tgz（bundle 路径）
$install = & $DshCli plugin --profile rvguarder-ui add --store-dir (Join-Path $stage 'pnpm-store') $Package 2>&1
[IO.File]::WriteAllText((Join-Path $stage 'install.log'), ($install | Out-String))
$report['install'] = @{
    exit = $LASTEXITCODE
    mentionsBundle = ($install | Out-String) -notmatch 'declares no dsh\.bundle'
    manifest = (Get-Content (Join-Path $dshHome 'profiles\rvguarder-ui\package.json') -Raw | ConvertFrom-Json)
}

# 4) 启动后端（真实服务，端口 8785；DSH web 用 $port）
$backendProc = Start-Process -FilePath $python -ArgumentList @('-X','utf8','-m','clawRVguarder.hosts.dsh.server',
    '--project-dir', $project, '--dsh-home', $dshHome, '--workspace', $workspace,
    '--profile', 'rvguarder-ui', '--instance-id', 'rc3-ui', '--port', '8785', '--semantic-mode', 'local') `
    -WorkingDirectory $repo -PassThru -RedirectStandardOutput (Join-Path $stage 'backend.out.log') -RedirectStandardError (Join-Path $stage 'backend.err.log') -NoNewWindow
Start-Sleep -Seconds 4

# 5) 启动 DSH web profile
$hostProc = Start-Process -FilePath $DshCli -ArgumentList @('--profile','rvguarder-ui','--no-open','--port',"$port" ) `
    -WorkingDirectory $workspace -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stage 'host.out.log') -RedirectStandardError (Join-Path $stage 'host.err.log')
try {
    $launchToken = $null
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not $launchToken) {
        if ($hostProc.HasExited) { break }
        $out = (Get-Content (Join-Path $stage 'host.out.log') -Raw -ErrorAction SilentlyContinue) + (Get-Content (Join-Path $stage 'host.err.log') -Raw -ErrorAction SilentlyContinue)
        if ($out -match 'token=([A-Za-z0-9_\-\.]+)') { $launchToken = $Matches[1] }
        Start-Sleep -Milliseconds 500
    }
    if (-not $launchToken) { throw 'no launch token' }
    # 认证换 cookie
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/?token=$launchToken" -WebSession $session -Method GET -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop | Out-Null } catch { }
    Start-Sleep -Seconds 6

    # 6) RPC：pluginInventory.list —— 核心与管理条目应同时加载
    $inventory = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/pluginInventory/list" -WebSession $session -Method Post -ContentType 'application/json' -Body (@{ type='client-request'; rpcId='r1'; method='pluginInventory/list'; payload=@{ args = @{} } } | ConvertTo-Json -Depth 4)
    $report['inventory'] = $inventory.result.value.entries | ForEach-Object { @{ id = $_.entryId; module = $_.moduleName; enabled = $_.enabled; phase = $_.fiberPhase } }

    # 7) RPC：pluginManager.listBundles —— dsh-rvguarder 应为已安装 bundle
    $bundles = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/pluginManager/listBundles" -WebSession $session -Method Post -ContentType 'application/json' -Body (@{ type='client-request'; rpcId='r2'; method='pluginManager/listBundles'; payload=@{ args = @{} } } | ConvertTo-Json -Depth 4)
    $rvg = $bundles.result.value | Where-Object { $_.name -eq 'dsh-rvguarder' }
    $report['bundle'] = @{ name = $rvg.name; version = $rvg.version; installed = $rvg.installed; enabled = $rvg.enabled; official = $rvg.official; availability = $rvg.availability; error = $rvg.error }

    # 8) RPC：rvguarderAdmin/overview —— owner 认证管理通道（失败不中止，记录诊断）
    try {
        $overview = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/rvguarderAdmin/overview" -WebSession $session -Method Post -ContentType 'application/json' -Body (@{ type='client-request'; rpcId='r3'; method='rvguarderAdmin/overview'; payload=@{ args = @{} } } | ConvertTo-Json -Depth 4)
        $report['adminOverview'] = $overview.result
    } catch {
        $code = try { [int]$_.Exception.Response.StatusCode } catch { -1 }
        $detail = ''
        try { $stream = $_.Exception.Response.GetResponseStream(); if ($stream) { $reader = New-Object IO.StreamReader($stream); $detail = $reader.ReadToEnd() } } catch {}
        $report['adminOverview'] = @{ error = "HTTP $code"; detail = $detail.Substring(0, [Math]::Min(500, $detail.Length)) }
    }

    # 9) 负例：未认证调用管理通道 → 401
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/rvguarderAdmin/overview" -Method Post -ContentType 'application/json' -Body (@{ type='client-request'; rpcId='r4'; method='rvguarderAdmin/overview'; payload=@{ args = @{} } } | ConvertTo-Json -Depth 4) | Out-Null
        $report['anonymous'] = 'unexpected-success'
    } catch {
        $report['anonymous'] = [int]$_.Exception.Response.StatusCode
    }

    # 10) 核心回归：后端握手（插件心跳已到达；后端固定 8785）
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:8785/api/dsh/status" -Headers @{ 'x-rvguarder-token' = $token } -Method Get
        $report['guardHandshake'] = @{ active = $status.hook.active; sdk = $status.hook.sdk_version; protocol = $status.protocol }
    } catch { $report['guardHandshake'] = @{ error = 'status-failed' } }
}
finally {
    Stop-Tree $hostProc.Id
    Stop-Tree $backendProc.Id
    Start-Sleep -Seconds 2
}
$report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $stage 'result.json')
Write-Host ($report | ConvertTo-Json -Depth 8)
if ($report.install.exit -ne 0 -or !$report.bundle.installed -or $report.adminOverview.type -eq 'error' -or !$report.adminOverview.value.backend.online -or $report.anonymous -ne 401 -or !$report.guardHandshake.active) {
    throw 'Real rc.3 verification failed; inspect result.json.'
}
