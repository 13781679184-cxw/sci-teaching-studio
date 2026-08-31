# Sci Teaching Studio

把 **sci-teaching-deck** Skill 装进人在环 Web 工作台：LangGraph Agent 编排全流程，关键节点门禁确认。

| | 链接 |
|---|------|
| **本仓库** | https://github.com/13781679184-cxw/sci-teaching-studio |
| **引擎 Skill** | https://github.com/13781679184-cxw/sci-teaching-deck |
| **在线演示（静态快照）** | https://sci-teaching-studio.pages.dev/ |

## 能力概览

- **LangGraph Agent** — 一条编排链路串联大纲、检索筛选、证据提取（含向量 RAG）、配图规划、裁剪、出片与交付；工具调用 deck 脚本，线程可恢复
- **三门禁 HITL** — 大纲 / 文献名单 / 证据与配图：`interrupt` 等人确认，`resume` 继续
- **双入口** — Agent 一键跑通（`POST /projects/{id}/agent/run`）或按步 Jobs + 手动门禁，JSON / PPTX 均为事实源

| 层 | 职责 |
|----|------|
| `backend/agent/` | LangGraph 编排、interrupt / resume |
| `backend/teaching_api.py` | 项目 / 门禁 / jobs |
| `frontend/` | Vite + React 门禁工作台 |
| `../sci-teaching-deck` | 生成引擎（Skill + 脚本） |

**文档**

- 本地启动：[`RUN.md`](RUN.md)
- LangGraph Agent API：[`backend/AGENT-LANGGRAPH.md`](backend/AGENT-LANGGRAPH.md)
- 临时公网分享：[`SHARE-HOURS.md`](SHARE-HOURS.md)
- 在线演示站（静态快照）：**[Cloudflare Pages](https://sci-teaching-studio.pages.dev/)**（见 [`CLOUDFLARE-PAGES.md`](CLOUDFLARE-PAGES.md)）

### 演示站（Cloudflare Pages · 主）

公开展示站使用**真实项目快照**（`my-ppt`：小分子药物设计），界面与本机 Studio 一致，配图与页预览为真实文件。

**https://sci-teaching-studio.pages.dev/**

```powershell
# 从 workspace/my-ppt 重新打包快照（改课件后重跑）
cd sci-teaching-studio\backend
..\.venv\Scripts\python.exe ..\scripts\pack_showcase.py   # 若无此 venv：用 deck 的 python + PYTHONPATH

cd ..\frontend
npm install
npm run build:demo
npm run deploy:pages   # 需 wrangler login + Pages 项目 sci-teaching-studio
```

推送 `main` 后 Actions 会发布 Cloudflare Pages（需配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，见 `CLOUDFLARE-PAGES.md`）。

GitHub Pages 镜像（可选）：`npm run build:demo:github` → https://13781679184-cxw.github.io/sci-teaching-studio/

依赖旁路引擎仓库 **[sci-teaching-deck](https://github.com/13781679184-cxw/sci-teaching-deck)**（Skill / CLI 管线）。两仓请放在同一父目录下：

```text
parent/
  sci-teaching-deck/      # https://github.com/13781679184-cxw/sci-teaching-deck
  sci-teaching-studio/    # 本仓库
```
