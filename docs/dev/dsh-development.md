# DSH 插件开发

普通用户请阅读 [下载安装](../deployment/dsh.md)。本页面向修改 RVguarder 源码的开发者。

## 开发 profile

本项目的真实宿主调试、桌面复查及人工集成测试统一使用 **`~/.dsh/profiles/rvguarder-dev`**，不在仓库中另建 desktop profile。日常使用的 `desktop` 和 `web` profile 不用于项目测试。单元测试的一次性数据 fixture 不作为长期宿主 profile。

后台受控资源根固定在 `~/.dsh/workspaces/rvguarder-dev`；会话的实际工作目录由 DSH 管理。以下脚本仅选择开发 profile，不切换调用者目录：

```powershell
.\dshRVguarder\scripts\start-dev-profile.ps1
```

也可从任意目录直接运行 `dsh rvguarder-dev`。插件设置和运行数据保存在用户的 DSH 目录中，不进入 Git。更新插件前先退出这个 profile，再安装新的整包。

## 构建与检查

构建机需要 Python 3.13+、Node.js 24 及目标平台的 DSH SDK。

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend run build:embedded
npm --prefix dshRVguarder ci --ignore-scripts --legacy-peer-deps
node dshRVguarder/scripts/link-sdk.mjs '<DSH SDK 根目录>'
npm --prefix dshRVguarder run check
npm --prefix dshRVguarder test
python -m pip install -r dshRVguarder/requirements-standalone.txt
python -m pip install --no-deps -e .
python dshRVguarder/scripts/build-standalone.py --frontend-built --output dist/dsh-rvguarder-build
```

`--output` 必须指定新目录。将生成的 Windows x64 tgz 安装到开发 profile：

```powershell
dsh plugin --profile rvguarder-dev add .\dist\dsh-rvguarder-build\dsh-rvguarder-0.2.1-rc1-win32-x64.tgz
```

平台整包是用户安装和集成测试使用的产物。源码目录中的 `npm pack` 用于开发，不能替代整包构建。

构建产物、SDK 副本、缓存和测试数据均留在 Git 忽略目录中。提交前检查 `git status --short`；长期保留的验收结论放在文档中，截图与脱敏日志随本地验收归档保存。

可选宿主配置 `resourceWorkspace` 指定绝对路径的受控资源根，核心和管理组件应使用相同值，供启用签名字节执行器的开发测试使用；它不覆盖会话 cwd。该根不能与 Guard 数据、插件状态或运行时缓存互相包含。普通工具调用使用 SDK 提供的每次调用 cwd，受控执行器继续校验签名、资源版本及已登记资源根。

## 直接启动回归

安装整包、退出正在使用的开发宿主后运行：

```powershell
node dshRVguarder/scripts/verify-dev-startup.mjs --output runtime/startup-proof
```

输出目录必须是新目录。此脚本仅使用现有 `rvguarder-dev` profile，从用户目录、DSH_HOME、盘符根和仓库目录分别启动，读取宿主侧概览验证连接和实例身份，再正常卸载每个测试宿主。它不执行 Agent 工具、不修改会话工作目录，不读取启动链接或认证令牌。不要将其原始宿主日志作为公开附件；使用生成的 JSON 验收摘要。

## 发布构建

当前版本为 `0.2.1-rc1`。产品/npm 版本使用此格式，Python 元数据使用 `0.2.1rc1`，SDK 和 PMKB 独立版本不随产品变化。整包构建从干净提交执行，输出包含 tgz、根目录可直接安装的 distribution ZIP、安装说明、版本说明、来源信息、许可证及 SHA256SUMS。

```powershell
python dshRVguarder/scripts/verify-release.py dist/dsh-rvguarder-0.2.1-rc1
```

ZIP 与 tgz 的文件内容应完全一致。发布准备不运行源码目录的 `npm publish`，源码包保留 private 标记；对外使用冻结整包。本机测试原始日志可能包含宿主启动认证链接，不作为公开附件。
