# rc.5 独立复验（2026-10-29）

实施基线 `1539653`，Windows x64 + DSH `0.2.1-rc.3`。原 `f3990e8` 的 [13项历史结论](ui-review-2026-10-28.md) 保持 **5通过/3不通过/5待整改**，本表只记录后续修复。POL-01/02、PMKB、授权语义未改；不宣称 rc.2 UI 或 Linux 整包通过。

## 本轮实现与证据

- 语言读取 `getSnapshot().active`，订阅 locale/theme；每个挂载独立 store、API、transport、轮询与样式引用计数，关闭后的响应不能写入新实例或触发下载。键盘方向/Home/End导航保留焦点，更新外观不重挂载，不改宿主全局主题。
- overview 兼容增加 deployment mode/state/reason；启动中及失败不会无限等待连接 Promise。首次失败可重连，401/403/500、坏JSON、错误实例、恢复锁定不伪装为空数据成功。
- 运行时验证 manifest 后，由短命冻结自举程序部署到私有内容哈希目录；常驻程序不占用npm安装目录。共享引用及退出等待防止快速重启并发占用，旧版本与数据保留。
- 冻结维护命令 inspect/apply/rollback，按旧绑定沿用令牌/审计/RV/队列；私有备份、独占锁内重检摘要、失败恢复、二次修改拒绝回滚。其他插件/禁用/完整config/自定义标签保留；不可靠覆盖、include、动态自身配置和未确认执行拒绝。
- 认证客户端探针实际取根启动链接签发的 owner cookie（`/connect` 是 API operator），解析boot graph、请求实际客户端资源并验证注册内容。失败退出码不再依赖PowerShellHTML解析假设。

本地原始证据在 `runtime/rc5-evidence/`；不入库的隔离home和临时认证日志不属于交付包。桌面截图位于其 `desktop/` 与 `desktop-final-review/` 子目录；后者保存此次恢复控制后的修复前/后证据。使用现有桌面rc.3，独立DSH_HOME和Electron用户数据目录；测试窗口的登录由用户手动完成，未读取密钥。

## 第13节对应复验

| 编号 | rc.5结论 | 证据与边界 |
| --- | --- | --- |
| UI-01 | 通过 | 桌面插件详情为0.2.0-rc.5，真实bundle含核心/管理两个运行组件；真实rc.3脚本清单一致。 |
| UI-02 | 通过 | 桌面账号菜单→设置→RVguarder直接加载，无浏览器跳转/Guard令牌输入。 |
| UI-03 | 通过（所列功能范围） | 首批ff5af23整包真实rc.3浏览器9/9；此次追加真实桌面六个页签复查及最终b1ffdd9整包已连接截图。末次没有重跑9项宿主浏览器，不能将首批结果写成末次整包9/9。 |
| UI-04 | **通过（真实桌面 rc.3）** | 恢复控制后完成中/英文 × 亮/暗四组外观、六个页签、规则文字/风险标签、方向/Home/End焦点、关闭重开检查。真实主题快照修为 `getTheme().active.colorScheme`；末次整包确认“未运行”本地化与连接就绪。宿主通用设置切页会卸载插件面板；同一挂载内实时更新保页面/焦点由13项组件矩阵覆盖，不混称桌面原位切换。 |
| UI-05 | 通过（矩阵范围） | 组件故障矩阵+真实HTTP管理负例，离线恢复12项矩阵通过；不把rc.2 UI未测写成通过。 |
| SEC-01 | 通过 | 实际整包浏览器资源、DOM、URL、存储和overview扫描临时令牌/签名密钥；包清单无令牌、私钥、执行队列或数据库。 |
| SEC-02 | 通过 | Node逐方法owner负例；真实匿名401。 |
| SEC-03 | 通过 | 固定10个管理方法，没有迁移/审批代理/执行证据写入或任意下载Remote。 |
| LIFE-01 | 通过（所列矩阵） | 重复挂载/旧响应、共享托管/快速重启通过；桌面禁用、恢复、正常退出及最新包重启：运行时1后端，退出0后端。此前隔离CLI升级、卸载保数据、rc.4回滚保身份、异常退出随stdin EOF关后端的证据保留。旧租约需离线核对后移入备份，未自动清空队列。 |
| MIG-01 | 通过（受支持配置） | 16项迁移测试含冻结程序仓库外inspect/apply/rollback、真实dispatched完成事件只补交一次、令牌/历史保留、幂等/失败恢复/回滚及拒绝矩阵。外部模式回滚恢复原配置，需使用兼容旧服务或随包exe手动启动，未自动接管。 |
| PKG-01 | 通过（Windows x64） | 验证整包324文件、281项运行时清单、50份许可证文件及来源commit/clean标记；独立真实宿主安装。最终交付目录附SHA256SUMS与准确INSTALL。 |
| REG-01 | **待整改** | 最新Node三轮均52通过/1真实PTC沙箱跳过，十并发均通过；文本修正后组件矩阵13/13、同批冻结生命周期6/6、冻结迁移CLI 1/1。Python两个既有规则链断言仍失败，全量回归未完成，不能签署全部通过。 |
| DOC-01 | 通过 | rc.5部署命令区分新安装、离线保历史迁移、托管升级与外部配置回滚；历史审查与本轮缺口分开记录。 |

## 回归记录

| 命令/场景 | 结果 |
| --- | --- |
| `npm run check`，普通及内嵌前端构建 | 通过 |
| `npm test`（Node24，实际CPython3.13核心、SDK、冻结生命周期） | 首批三轮49通过/1跳过；此次补充主题快照/恢复状态断言后连续三轮各52通过/1真实PTC沙箱跳过，0失败 |
| 原十路`Promise.all` | 三轮完整回归均通过；整用例10.81/12.69/12.42秒，包括准备/结果补交/清理，不是单次HTTP延迟 |
| 实际内嵌构建组件Playwright | 最新13/13通过，含7类错误、恢复、语言/主题/焦点、双实例/旧响应、5次挂载无残留timer/style，以及暗色文字对比度≥4.5、not_run中英文映射 |
| 原`verify-rc3-ui.ps1`真实宿主脚本 | 通过，rc.5 bundle、双组件、owner overview、匿名401、核心握手 |
| `verify-rc3-client.ps1` | 通过，认证HTML200、实际boot entry与客户端注册资源；脚本失败时返回非零 |
| OpenClaw独立工作台Chromium | 6/6通过 |
| DSH独立工作台Chromium | 4/4通过 |
| Python相关回归（同版CPython3.13，DSH/迁移/存储/审计/UI） | 74通过、1可选SQLAlchemy未安装跳过、2既有规则链失败；迁移冻结维护子集16/16通过 |
| 整包浏览器生命周期 | 原8功能项通过；新增启停用例初次按错误的entryId和卸载清单形状定位失败，按宿主真实moduleName与bundle.enabled修正后1/1通过；不能把错误定位的失败轮计通过 |
| 同批tgz浏览器、冻结维护及托管子进程 | 首批ff5af23浏览器9/9、冻结迁移CLI 1/1、冻结生命周期5/5；最终b1ffdd9补测冻结迁移CLI 1/1与冻结生命周期6/6 |
| 实际HTTP故障探针 | 不响应服务在515ms有界返回离线，只有1个请求；坏JSON在8ms明确拒绝，无自动重试 |

性能证据 `final-node-timings.jsonl` 与 `node-final-{1,2,3}.log` 仅含固定阶段和毫秒数。初次复现十路请求时before排队达4803.93ms、持锁最长923.70ms，5秒原超时确实触发。修复单飞握手、重复初始心跳、audit连接复用以及journal DELETE→WAL/FULL；不扩大超时，不重跑工具，不降低持久化同步级别，不串行化十路用例。修复后连续三轮通过。前期第二轮清理报错跳过子进程终止导致挂起，测试清理已改finally，失败日志保留，未将那轮计通过。

Python初次未指定UTF-8启动时两个文本测试出现cp1252解码错误，新增迁移测试已显式UTF-8，正式命令使用`-X utf8`。直接对整个tests目录收集曾被`.gitignore`忽略的本机研究文件`test_atlas_tool_boundaries.py`旧包名阻断，未修改该实验；后续全量尝试仅选择受版本控制的测试及新增迁移测试。

全量832项尝试未完成：共享OpenClaw测试初始化/探测明显缓慢，已中止，不计全量通过。本轮完成上表全部相关回归。测试子进程显式保留空白`DEEPSEEK_API_KEY`，防止集合导入时dotenv再载入工作区配置；构建环境未安装测试依赖，测试使用本地纯Python依赖副本。`python-related-final.log`为正式相关结果，先前中止/编码失败日志均保留。

隔离桌面生命周期证据：`desktop/after-upgrade.json`确认原实例与token摘要不变；`uninstall-result.json`为零后端且数据保留；`rollback-and-abrupt-exit.json`确认rc.4回滚保token、宿主异常退出后后端自行退出。未操作日常DSH窗口。此次已恢复控制并完成UI-04；全部安全回归仍因下述既有失败保持未完成。

剩余问题：两个既有规则链断言分别为`test_dsh_chain_uses_only_successful_sensitive_history[True]`与`test_native_approval_cannot_reuse_permission_after_new_chain_evidence`。使用1539653原始DSH services及db_store在独立测试进程复现相同2失败/1通过，见`policy-baseline.log`。本轮不更改其断言或规则，不签署全量安全验收。rc.2 UI、Linux整包、真实PTC沙箱、在线模型/长期稳定性保留未验收。

## 桌面续验与追加修复

2026-10-29恢复Computer Use后，仅操作隔离窗口，未改变日常DSH配置。源码`377d789`修正主题快照真实层级和深色完整局部配色；核心因旧租约/未确认执行拒绝启动时，通过内部共享状态呈现恢复锁定，未添加Remote或改变授权/租约语义。`b1ffdd9`仅追加“not_run → 未运行 / Not run”显示及组件断言。

独立DSH_HOME与Electron用户目录沿用`runtime/rc5-evidence/desktop/`。用户手动完成测试模型配置，未读取密钥、未调用在线模型。截图`before-*`属于修复前；`after-*`为377d789，最终`final-package-*`为b1ffdd9。宿主为0.2.1-rc.3；同版本tgz替换后正常退出重启，避免宿主Node模块缓存使前后端混用。末次安装来源为`dist/dsh-rvguarder-0.2.0-rc.5-desktop-final/`。

| 桌面场景 | 独立结论与证据 |
| --- | --- |
| 中英文、亮暗四组 | 通过；`after-{en,zh}-{light,dark}-overview.jpg`，系统深色快照正确，文字及原生下拉框可读。 |
| 规则与风险标签、键盘页签 | 通过；`after-en-dark-keyboard-rules.jpg`，Tab/Shift+Tab取得焦点后Right切页，End到设置，Home回概览；焦点边框可见。 |
| 六个页签、扫描与审计空态 | 通过；扫描页和审计页分别留截图，规则79条；扫描已有结果中的unknown/unsupported如实显示，没有计作安全基线已通过。 |
| 初始恢复锁定 | 通过；`after-en-dark-recovery-locked.jpg`明确显示`recovery-required`、重连入口和失败状态。 |
| 停用、核对、恢复 | 通过；确认旧PID 32172已退出，调用表0、执行队列0、完成文件0，将旧租约移至本地备份后重新启用；`recovery-result.json`确认令牌不变，正常退出释放租约。数据库WAL/SHM在正常checkpoint后消失属于SQLite维护文件，不是业务历史删除。此空实例恢复不代替有历史迁移16项测试。 |
| 托管数量与正常退出 | 通过；`after-package-enabled.jpg`双组件运行，末次`final-live-process.json`确认1个私有运行时后端，退出后0个。 |
| 最后文本修正与关闭 | 通过；`final-package-zh-dark-overview.jpg`显示“未运行”、插件已连接、运行时已就绪，`final-package-close-to-host.jpg`回到宿主会话。 |

此次追加Node日志为`verified-node-{1,2,3}.log`（53项：52通过/1跳过，三轮十并发不变），文本修正后的矩阵为`text-component-matrix.log`（13通过）。最新整包冻结程序为`final-frozen-managed.log`（6通过）、`final-frozen-cli.log`（1通过）。最初受限执行上下文下两项冻结后端启动超时，随后相同包本机上下文通过，失败日志保留；第一次构建因全局npm缓存EPERM失败，改用工作区缓存后成功，不把失败轮计作通过。

自动审批拒绝了从桌面宿主日志提取启动令牌并交换owner cookie的诊断，原因是该会话材料来源未获明确授权；没有换工具重试该诊断，改用已授权的原生插件页和设置页。原先独立宿主脚本/浏览器结果保留其执行批次，不宣称此次又运行通过。

## 本地交付

最新整包：`dist/dsh-rvguarder-0.2.0-rc.5-desktop-final/dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz`，18,171,338字节，SHA-256 `54f78fdd4e1b11b67b1c7d768a6c78a9bd7250385726843bddee8a8bc47f3237`。构建来源`b1ffdd989eb66f3f62696aa345d145652c1bf3aa`，`source_tree_dirty=false`；324文件、281运行时清单项、50份许可证文件全部核对。末次文档提交不改变已验证包字节；包内复验表是构建时的历史快照，以tgz旁的本表为最新结论。

旧`rc.5-final`的577136…及中间`rc.5-desktop-verified`的eccebe…均保留供溯源，已被最新包替代。目录附INSTALL、SHA256SUMS、来源记录和精选脱敏EVIDENCE.zip；不附私有home、原始认证日志或浏览器trace。**新装平台整包后无需另装或单独启动Python，托管后端随插件启停。** 旧外部实例先按INSTALL离线迁移；升级退出目标宿主后安装，避免运行中模块缓存。

本轮13项复验为12通过（各行限定范围）、REG-01待整改；历史f3990e8的5通过/3不通过/5待整改不变。两个既有规则链失败、rc.2 UI、Linux整包、真实PTC沙箱、在线模型/长期稳定性仍未关闭，不称为全项安全验收或正式发布。桌面复查结束后停止输入，隔离宿主正常退出；日常窗口未修改。没有推送或创建远程Release。
