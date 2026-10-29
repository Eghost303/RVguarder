# 本地部署

当前版本 **v0.2.1-rc.1**。本页面向 OpenClaw 集成，Release wheel 的安装见 [部署与使用](../ops/quickstart.md)。DSH 用户请阅读 [DSH 插件下载安装](dsh.md)，无需执行本页的 Python 安装命令。

## 推荐流程

```bash
cd RVguarder
pip install -e .
npm --prefix frontend ci
npm --prefix frontend run build
openclaw-guard run
```

启动后自动完成：发现 OpenClaw 配置 → 准备目录 → 补齐基线 → 生成 Hook 插件 → 启动工作台。

## 常见用法

### 启动主服务

```bash
openclaw-guard run
```

### 启动但不自动打开浏览器

```bash
openclaw-guard run --no-browser
```

### 仅做一次性自检（不启动长期服务）

```bash
openclaw-guard run --once --no-browser
```

### 运行基线扫描

```bash
openclaw-guard baseline
```

### 导出审计数据

```bash
openclaw-guard export-audit --output /path/to/audit.json
```

### 检查运行链路健康状况

```bash
openclaw-guard doctor
```

## 建议目录

- 项目目录：`RVguarder/`
- OpenClaw 配置：`~/.openclaw/openclaw.json`

## 依赖现状

- `fastapi>=0.115.0` 与基础 `uvicorn>=0.30.0` 是必需依赖；`pip install -e .` 即会安装默认服务所需组件
- `uvicorn[standard]>=0.30.0` 属于可选的 `performance` 扩展组，不会默认安装；需要兼容的可选加速等组件时，可显式执行 `python -m pip install -e ".[performance]"`，默认服务不依赖这些扩展
- `openclaw-guard run` 仅启动 FastAPI + uvicorn；依赖缺失会报出安装提示，不会静默切换到旧服务
- 旧版 stdlib HTTP 实现已移出生产包；部署只使用 `openclaw-guard run` 启动 FastAPI

## 卸载

由于 Guard 是纯 Python 包，卸载只需：

```bash
openclaw-guard uninstall-hook   # 先移除 OpenClaw 配置中的 Hook 引用
pip uninstall openclaw-guard
```
