# LangGraph Agent（Studio）

Studio 后端用 **LangGraph** 编排现有 deck 脚本（工具仍是 `jobs.py` 调 `sci-teaching-deck/scripts/*`），人工门禁用 `interrupt` / `resume`。

## API

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/projects/{id}/agent/run` | 启动编排（后台线程） |
| POST | `/projects/{id}/agent/resume` | 门禁确认后继续 |
| GET | `/projects/{id}/agent/threads` | 本项目线程列表 |
| GET | `/agent/threads/{thread_id}` | 轮询状态 |

`status`：`running` | `interrupted` | `ok` | `error`  
`interrupted` 时看 `interrupt.gate`（`gate1_outline` / `gate2_sources` / `gate3_evidence_visual`）。

旧的逐步 `POST /jobs` + `POST /gates/.../confirm` **仍可用**；Agent 是并行入口。

## 图节点顺序

```text
outline → [Gate1] → retrieve_screen → [Gate2+confirm_sources]
       → extract(+vector RAG) + plan_figures → [Gate3+confirm_figures]
       → crop → draft → fill → deliver
```

依赖：`pip install -r backend/requirements.txt`（含 `langgraph`）。
