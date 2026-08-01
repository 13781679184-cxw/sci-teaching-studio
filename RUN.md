# Sci Teaching Studio · 怎么启动

> HITL Web 壳：门禁确认 + 触发 `sci-teaching-deck` 脚本。JSON/PPTX 仍是事实源与交付物。

## 前置

- 旁路已有 `../sci-teaching-deck`（含 `.venv`）
- Node ≥ 18、本机 Python 能装 FastAPI

## 1. API（:2025）

```powershell
cd sci-teaching-studio\backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
$env:PYTHONUTF8='1'
# 可选：显式指定引擎与解释器
# $env:SCI_TEACHING_DECK_ROOT = 'C:\...\sci-teaching-deck'
# $env:SCI_TEACHING_PYTHON = 'C:\...\sci-teaching-deck\.venv\Scripts\python.exe'
.\.venv\Scripts\uvicorn.exe teaching_api:app --port 2025 --reload
```

健康检查：http://127.0.0.1:2025/health

## 2. 前端（:5180）

```powershell
cd sci-teaching-studio\frontend
npm install
npm run dev
```

打开 http://localhost:5180 —— `/api` 已反代到 :2025。

## 3. 试用多肽 UAT

左侧应直接列出 `ai-peptide-seq-generation`（来自 `sci-teaching-deck/uat`）。点开 → 交付页可下载 `final.pptx`。

新课：左侧贴需求 → 创建 → **自动根据需求生成大纲**（需求写入内部 `project_brief.md`，界面不再单独走简报步）→ 大纲页改完确认 → 文献/配图流水线。

大纲页可点「AI 根据简报生成大纲」重拟（仍读内部简报文件）。

## 架构

见 `../sci-teaching-deck/references/12-web-studio-sketch.md`。
