# dshRVguarder

DSH **0.2.1-rc.2** 的 RVguarder 适配插件，当前为 **0.1.0 测试候选**。工程位于 `RVguarder/dshRVguarder/`，复用 Python 核心和 Preact Dashboard。

已实现真实 SDK 门禁、原生审批、单调拒绝守卫、PMKB/RV/LLM 桥接、成功历史去重恢复、审批后重评估、DSH 扫描与 JSON/HTML/PDF、工作台认证/规则/审计和配套打包。

Python 适配在 `../clawRVguarder/hosts/dsh/`，共享边界为 `hosts/base.py`；PMKB、RV 和前端保持单一源。

需要 Python 3.13+、Node 24 和已安装的 DSH 0.2.1-rc.2：

```bash
npm ci --ignore-scripts --legacy-peer-deps
node scripts/link-sdk.mjs '<DSH 安装根目录>'
npm run check
npm test
npm pack
```

安装见 [部署说明](docs/deployment.md)，本机路径见 [Windows 环境](docs/windows-environment.md)，实测和未完成项见 [验证记录](docs/validation-2026-10-20.md)。

发行产物位于仓库根 `dist/dsh-rvguarder-0.1.0/`：插件 tgz（12.3 kB）、Python wheel、`INSTALL.md`、`create-test-profile.mjs` 与 `manifest.json`（SHA-256 全部匹配）。

采用外部托管 Python 服务，插件不自动启停 Python。已在临时 Windows DSH web profile 和 WSL 原生 DSH（`~/.npm-global/bin/dsh`，0.2.1-rc.2）上验证加载与握手；完整 PTC/子 Agent、在线 LLM、Windows ACL 和强内容血缘采集仍需整机验收。工具返回文本不是可信内容收据。
