# rc.5 Windows x64 安装与维护

适用 DSH **0.2.1-rc.3 Windows x64**。平台整包为 `dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz`，自带 Python 3.13、基础依赖、UI、PMKB/RV 和维护命令。运行时无需 pip、Python、WSL、源码或联网下载依赖。DSH 自身安装依赖可能使用其包管理缓存；不宣称宿主整个安装过程已经断网验收。普通 `npm pack` 是外部后端轻量包，不能替代平台整包。

## 新安装

下载整包与同批 `SHA256SUMS`，核对哈希。退出目标 DSH 后安装到它实际使用的 profile（桌面通常为 `desktop`，自定义 profile 按实际值）。

```powershell
Get-FileHash .\dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz -Algorithm SHA256
dsh.cmd plugin --profile desktop add .\dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz
```

也可使用 DSH 的插件安装入口选择该 tgz。启动 DSH，在“插件 → 已安装”确认版本及两个组件，在“设置 → RVguarder”查看托管状态。**无需单独启动 Python 后端。** 浏览器只使用宿主 owner 管理通道，不输入桥接令牌。

数据默认为 `<DSH_HOME>/rvguarder/dsh-<home/profile哈希>/`，端口自动分配，仅绑定本机。常驻 executable/DLL 来自 `<DSH_HOME>/rvguarder/runtimes/<manifest内容哈希>/` 的私有副本；升级不会锁住 npm 安装目录。旧运行时保留，故障不删除数据或退回空实例。核心与管理组件共用一个托管进程，最后一个组件关闭才停止后端。

## 旧实例保历史迁移

先正常退出目标 DSH 和旧后端。不得自动终止未知服务。确认没有未核对的执行；保留待补交的**已确认**完成事件。使用 Windows 自带 tar 将新包解到一个新的维护目录，无需安装 Python：

```powershell
New-Item -ItemType Directory .\rvguarder-maintenance
tar -xf .\dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz -C .\rvguarder-maintenance
$backend = (Resolve-Path .\rvguarder-maintenance\package\backend\rvguarder-backend.exe).Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profile = Join-Path $dshHome 'profiles\desktop'
$preview = (& $backend migrate inspect --profile-dir $profile | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or !$preview.ready) { throw '预检失败，先核对报告' }
$preview.diff
& $backend migrate apply --profile-dir $profile --digest $preview.digest
if ($LASTEXITCODE -ne 0) { throw '迁移失败，配置已尝试恢复，请检查错误' }
```

保存 apply 返回的 `backup` 名称。然后安装新整包到同一 profile 并启动 DSH。迁移写入 `managedBinding: {projectDir, instanceId, stateDir}`，原地沿用旧令牌、审计、RV、执行日志和完成队列。新配置仍保留全部 RVguarder 参数、禁用状态及其他插件。被禁用的实例不会因迁移自行启用。

inspect 不写源配置或业务历史；校验私有权限、协议/schema、绑定、数据库与 JSONL 审计链、执行及完成队列和独占锁。JSON 格式 patch 与 YAML 均支持；其他插件的自定义 YAML 标签保留，不求值。自身动态配置、include、重复/歧义条目、高优先级非空全局 patch、未知协议、正在占用或未确认执行会拒绝，需人工消除歧义后重新 inspect。不得用清空队列或改 instanceId 绕过拒绝。

apply 取得现有数据锁后再次核验摘要和历史，在 profile 下创建仅当前用户/SYSTEM 可读的 `.rvguarder-migration-*` 备份，再逐文件原子替换。任一步失败恢复配置。重复执行不创建新备份。没有为迁移增加 HTTP/Remote 方法。

## 升级、恢复及回滚

普通托管升级：退出目标 DSH，确认托管进程已退出，安装新平台 tgz，再启动同一 profile。禁用、卸载和异常宿主退出均保留数据；stdin EOF 使后端退出。旧运行时留在私有缓存，不自动清理。

启动中、离线、认证失败、实例不符、恢复锁定、运行时损坏分别呈现；首次连接失败也可重新连接。运行时损坏时重新安装同一或兼容整包；绑定错误先核对 profile/数据目录。恢复锁定必须对照实际工具结果完成核对，不自动重跑工具或删除日志。rc.5 未新增历史核对/授权语义。

迁移回滚必须先退出宿主与后端：

```powershell
& $backend migrate rollback --profile-dir $profile --backup '.rvguarder-migration-<apply返回值>'
if ($LASTEXITCODE -ne 0) { throw '回滚拒绝或失败，勿覆盖人工修改' }
```

该命令恢复对应 profile 配置，保留迁移后的业务历史；配置再次修改时拒绝覆盖。之后恢复对应旧插件包。若原配置为外部后端模式，需启动与原协议/schema 兼容的后端；可以用随包 executable 代替 Python，参数须来自原绑定：

```powershell
& $backend --project-dir '<旧projectDir>' --dsh-home '<原DSH_HOME>' --profile '<原profile>' --workspace '<原workspace>' --instance-id '<原instanceId>' --port 8781
```

托管版本间回滚：退出宿主，安装保留的兼容旧平台 tgz，再启动同一 profile。rc.5 仍为 `dsh-guard-v2` / journal schema 2；不保证任意未来版本降级。迁移命令不自动启动或接管外部服务，也不将外部配置悄悄改成其他运行模式。

## 构建与证据

构建机需 Python 3.13+、Node 24 与锁定构建依赖；终端用户不需要。前端普通和内嵌构建后，运行 `scripts/build-standalone.py --frontend-built --output <新目录>`。产物含许可证、依赖版本、来源 commit/dirty 标记及运行时文件 SHA-256 清单。复验范围与未完成项见 [rc.5 复验表](rc5-revalidation-2026-10-29.md)。rc.2 核心兼容保留；rc.2 UI、Linux 整包和不可用的真实 PTC 沙箱不计通过。POL-01/02、PMKB 和授权语义未改。
