# dshRVguarder

DSH **0.2.1-rc.2** 的 RVguarder 适配插件，当前为 **0.2.0-rc.1 测试候选**。工程位于 `RVguarder/dshRVguarder/`，复用 Python 核心和 Preact Dashboard。

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

发行产物位于仓库根 `dist/dsh-rvguarder-0.2.0-rc.1/`：插件 tgz、Python wheel、`INSTALL.md`、`create-test-profile.mjs` 与 `manifest.json`（SHA-256 全部匹配）。

采用外部托管 Python 服务，插件不自动启停 Python。已在临时 Windows DSH web profile 和 WSL 原生 DSH（`~/.npm-global/bin/dsh`，0.2.1-rc.2）上验证加载与握手；v2 已补充真实 Node PTC 内层测试、受控本地文件字节收据和 Windows ACL 临时边界探针（partial）。完整子 Agent、在线 LLM、长期稳定性和更广平台边界仍需验收。普通工具返回文本不是可信内容收据。

当前修复、升级约束和未完成门槛以 [v2 修复记录](docs/repair-2026-10-21.md) 为准。必须配套安装 v2 后端；旧队列先使用旧版本排空，不混用协议。

受控外发默认禁用：配置双端精确HTTPS白名单后，还需每次调用的宿主单次授权。私有凭据的实际Agent隔离仍是正式发布门槛。
