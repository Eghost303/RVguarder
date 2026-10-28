# DSH 插件开发

普通用户请阅读 [下载安装](../deployment/dsh.md)。本页面向修改 RVguarder 源码的开发者。

## 开发 profile

本项目的真实宿主调试、桌面复查及人工集成测试统一使用 **`~/.dsh/profiles/rvguarder-dev`**，不在仓库中另建 desktop profile。日常使用的 `desktop` 和 `web` profile 不用于项目测试。单元测试的一次性数据 fixture 不作为长期宿主 profile。

开发工作区位于 `~/.dsh/workspaces/rvguarder-dev`。启动：

```powershell
.\dshRVguarder\scripts\start-dev-profile.ps1
```

也可从开发工作区直接运行 `dsh --profile rvguarder-dev`。插件设置和运行数据保存在用户的 DSH 目录中，不进入 Git。更新插件前先退出这个 profile，再安装新的整包。

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
python -m pip install -e . pyinstaller
python dshRVguarder/scripts/build-standalone.py --frontend-built --output dist/dsh-rvguarder-build
```

`--output` 必须指定新目录。将生成的 Windows x64 tgz 安装到开发 profile：

```powershell
dsh plugin --profile rvguarder-dev add .\dist\dsh-rvguarder-build\dsh-rvguarder-0.2.0-rc.5-win32-x64.tgz
```

平台整包是用户安装和集成测试使用的产物。源码目录中的 `npm pack` 用于开发，不能替代整包构建。

构建产物、SDK 副本、缓存和测试数据均留在 Git 忽略目录中。提交前检查 `git status --short`；长期保留的验收结论放在文档中，截图与脱敏日志随本地验收归档保存。
