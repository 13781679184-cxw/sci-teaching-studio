# Sci Teaching Studio · 怎么启动

> HITL Web 工作台：LangGraph Agent 编排 deck 全流程，或按步 Jobs + 门禁确认。JSON / PPTX 为事实源与交付物。Agent API 见 [`backend/AGENT-LANGGRAPH.md`](backend/AGENT-LANGGRAPH.md)。

## 两种用法（先看这个）

| 方式 | 谁要装环境 | 说明 |
|------|------------|------|
| **约定时段试用** | 只有主持人本机 | 同事只开你发的隧道链接，**不必 clone GitHub**。见 [`SHARE-HOURS.md`](SHARE-HOURS.md) |
| **自己跑一份** | 每个人自己的电脑 | clone 两个仓库后，还要本地安装依赖（见下）。**只下载 zip/源码 ≠ 能直接用** |

## GitHub 上故意没有的东西

这些都会在本地自动生成或安装，**不要也不应上传**：

| 路径 | 是什么 | 你怎么得到 |
|------|--------|------------|
| `sci-teaching-deck/.venv` | Python 虚拟环境 | `python -m venv .venv` + `pip install -r requirements.txt` |
| `sci-teaching-studio/backend/.venv` | Studio API 的 Python 环境 | 同上（在 `backend/` 里） |
| `frontend/node_modules` | 前端 npm 依赖包 | `npm install` |
| `workspace/` | 本机项目数据、导出、**API Key** | 首次运行后自动出现；勿提交 |
| `sci-teaching-deck/uat/` | 本机试验课数据 | 可选；公开样例在 deck 的 `fixtures/` |

## 前置

- 两个仓库放在**同一父目录**（同级）：

```text
parent/
  sci-teaching-deck/       # https://github.com/13781679184-cxw/sci-teaching-deck
  sci-teaching-studio/     # 本仓库
```

- Node ≥ 18
- 本机 Python 能建 venv
- （预览导出）建议安装 LibreOffice；也可本机 PowerPoint

## 0. 引擎 deck 的 Python 环境（先做一次）

```powershell
cd ..\sci-teaching-deck
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

## 1. API（:2025）

```powershell
cd sci-teaching-studio\backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
$env:PYTHONUTF8='1'
$env:SCI_TEACHING_DECK_ROOT = (Resolve-Path ..\..\sci-teaching-deck).Path
$env:SCI_TEACHING_PYTHON = (Resolve-Path ..\..\sci-teaching-deck\.venv\Scripts\python.exe).Path
.\.venv\Scripts\python.exe -m uvicorn teaching_api:app --host 127.0.0.1 --port 2025
```

健康检查：http://127.0.0.1:2025/health

## 2. 前端（:5180）

另开一个终端：

```powershell
cd sci-teaching-studio\frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5180
```

打开 http://127.0.0.1:5180 —— `/api` 已反代到 :2025。

首次使用在网页「服务配置」里填模型 Key（会写入本地 `workspace/_settings`，不进 Git）。

## 3. 项目从哪来

- **新建**：左侧贴需求 → 创建 → 生成大纲 → 文献 / 配图 → 完成  
- **本机已有 UAT**（若你本地有 `sci-teaching-deck/uat/…`）：侧栏可能列出；该目录默认不在 GitHub 上

## 架构

见 `../sci-teaching-deck/references/12-web-studio-sketch.md`。
