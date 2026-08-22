"""LangGraph agent runtime for sci-teaching-studio.

Orchestrates existing deck jobs as tools, with HITL interrupts at outline /
sources / figures gates. Filesystem JSON contracts remain the source of truth.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any, Literal, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

import jobs as J
import projects as P


class AgentState(TypedDict, total=False):
    project_id: str
    thread_id: str
    phase: str
    log: list[str]
    error: str | None
    skip_outline_generate: bool
    skip_fill: bool


_CHECKPOINTER = MemorySaver()
_GRAPH = None
_LOCK = threading.Lock()
# thread_id → last known status payload (for GET)
_THREADS: dict[str, dict[str, Any]] = {}


def _append(state: AgentState, msg: str) -> list[str]:
    log = list(state.get("log") or [])
    log.append(msg)
    return log


def _run_tool(state: AgentState, step: str) -> AgentState:
    project_id = state["project_id"]
    log = _append(state, f"tool:{step}:start")
    try:
        J.run_step_blocking(project_id, step)
        log.append(f"tool:{step}:ok")
        return {**state, "log": log, "phase": step, "error": None}
    except Exception as exc:  # noqa: BLE001
        log.append(f"tool:{step}:error:{exc}")
        return {**state, "log": log, "phase": step, "error": str(exc)}


def node_outline(state: AgentState) -> AgentState:
    if state.get("skip_outline_generate"):
        return {**state, "phase": "outline_skipped", "log": _append(state, "skip generate_outline")}
    # If outline already confirmed, skip regenerate
    try:
        outline = P.load_json(state["project_id"], "source/outline.json")
        if outline.get("status") == "user_confirmed" and (outline.get("sections") or []):
            return {
                **state,
                "phase": "outline_exists",
                "log": _append(state, "outline already user_confirmed"),
            }
    except FileNotFoundError:
        pass
    return _run_tool(state, "generate_outline")


def node_gate_outline(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    payload = interrupt(
        {
            "gate": "gate1_outline",
            "project_id": state["project_id"],
            "message": "请确认大纲后再继续检索（Gate 1）",
        }
    )
    # resume value may be dict from API
    choice = "确认"
    if isinstance(payload, dict):
        choice = str(payload.get("user_choice") or choice)
        if payload.get("outline_status") or True:
            try:
                outline = P.load_json(state["project_id"], "source/outline.json")
                outline["status"] = payload.get("outline_status") or "user_confirmed"
                P.save_json(state["project_id"], "source/outline.json", outline)
            except FileNotFoundError:
                pass
        P.append_decision(
            state["project_id"],
            {
                "gate": "gate1_outline",
                "actor": {"kind": "user", "name": "langgraph"},
                "action": "confirm",
                "ai_recommendation": None,
                "user_choice": choice,
                "reason": payload.get("reason") if isinstance(payload, dict) else None,
                "before": None,
                "after": {"outline_status": "user_confirmed"},
                "affected_entities": [],
                "invalidation_scope": [],
            },
        )
    return {**state, "phase": "gate1_done", "log": _append(state, "gate1 confirmed")}


def node_retrieve_screen(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    return _run_tool(state, "retrieve_screen")


def node_gate_sources(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    payload = interrupt(
        {
            "gate": "gate2_sources",
            "project_id": state["project_id"],
            "message": "请确认文献选用；确认后将自动 accept keep/maybe 并抽取证据（Gate 2）",
        }
    )
    choice = "确认"
    reason = None
    if isinstance(payload, dict):
        choice = str(payload.get("user_choice") or choice)
        reason = payload.get("reason")
    # Materialize selection via existing script
    st = _run_tool(state, "confirm_sources")
    if st.get("error"):
        return st
    P.append_decision(
        state["project_id"],
        {
            "gate": "gate2_sources",
            "actor": {"kind": "user", "name": "langgraph"},
            "action": "confirm",
            "ai_recommendation": None,
            "user_choice": choice,
            "reason": reason,
            "before": None,
            "after": {"confirm_sources": "ok"},
            "affected_entities": [],
            "invalidation_scope": [],
        },
    )
    return {**st, "phase": "gate2_done", "log": _append(st, "gate2 confirmed")}


def node_extract_plan(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    st = _run_tool(state, "extract")
    if st.get("error"):
        return st
    return _run_tool(st, "plan_figures")


def node_gate_figures(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    payload = interrupt(
        {
            "gate": "gate3_evidence_visual",
            "project_id": state["project_id"],
            "message": "请确认配图方案后再成片（Gate 3）",
        }
    )
    choice = "确认"
    reason = None
    if isinstance(payload, dict):
        choice = str(payload.get("user_choice") or choice)
        reason = payload.get("reason")
    st = _run_tool(state, "confirm_figures")
    if st.get("error"):
        return st
    P.append_decision(
        state["project_id"],
        {
            "gate": "gate3_evidence_visual",
            "actor": {"kind": "user", "name": "langgraph"},
            "action": "confirm",
            "ai_recommendation": None,
            "user_choice": choice,
            "reason": reason,
            "before": None,
            "after": {"confirm_figures": "ok"},
            "affected_entities": [],
            "invalidation_scope": [],
        },
    )
    return {**st, "phase": "gate3_done", "log": _append(st, "gate3 confirmed")}


def node_deliver(state: AgentState) -> AgentState:
    if state.get("error"):
        return state
    st = _run_tool(state, "crop")
    if st.get("error"):
        # crop failures are common; continue with draft/fill
        st = {**st, "error": None, "log": _append(st, "crop failed — continue")}
    st = _run_tool(st, "draft")
    if st.get("error"):
        return st
    if not state.get("skip_fill"):
        st = _run_tool(st, "fill")
        if st.get("error"):
            st = {**st, "error": None, "log": _append(st, "fill failed — deliver anyway")}
    st = _run_tool(st, "deliver")
    if st.get("error"):
        return st
    return {**st, "phase": "done", "log": _append(st, "pipeline done")}


def _should_stop(state: AgentState) -> Literal["abort", "continue"]:
    return "abort" if state.get("error") else "continue"


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("outline", node_outline)
    g.add_node("gate_outline", node_gate_outline)
    g.add_node("retrieve_screen", node_retrieve_screen)
    g.add_node("gate_sources", node_gate_sources)
    g.add_node("extract_plan", node_extract_plan)
    g.add_node("gate_figures", node_gate_figures)
    g.add_node("deliver", node_deliver)

    g.add_edge(START, "outline")
    g.add_conditional_edges("outline", _should_stop, {"abort": END, "continue": "gate_outline"})
    g.add_edge("gate_outline", "retrieve_screen")
    g.add_conditional_edges(
        "retrieve_screen", _should_stop, {"abort": END, "continue": "gate_sources"}
    )
    g.add_conditional_edges(
        "gate_sources", _should_stop, {"abort": END, "continue": "extract_plan"}
    )
    g.add_conditional_edges(
        "extract_plan", _should_stop, {"abort": END, "continue": "gate_figures"}
    )
    g.add_conditional_edges(
        "gate_figures", _should_stop, {"abort": END, "continue": "deliver"}
    )
    g.add_edge("deliver", END)
    return g.compile(checkpointer=_CHECKPOINTER)


def get_graph():
    global _GRAPH
    with _LOCK:
        if _GRAPH is None:
            _GRAPH = build_graph()
        return _GRAPH


def _thread_key(project_id: str, thread_id: str | None) -> str:
    return thread_id or f"{project_id}-{uuid.uuid4().hex[:10]}"


def _snapshot(thread_id: str, project_id: str, result: Any) -> dict[str, Any]:
    """Normalize LangGraph result into API payload."""
    interrupted = None
    state_values: dict[str, Any] = {}
    status = "ok"

    if isinstance(result, dict):
        state_values = {k: v for k, v in result.items() if k != "__interrupt__"}
        interrupts = result.get("__interrupt__")
        if interrupts:
            status = "interrupted"
            first = interrupts[0]
            interrupted = getattr(first, "value", None)
            if interrupted is None and isinstance(first, dict):
                interrupted = first
            if interrupted is None:
                interrupted = {"raw": str(first)}

    payload = {
        "ok": status == "ok" and not state_values.get("error"),
        "status": "error" if state_values.get("error") else status,
        "thread_id": thread_id,
        "project_id": project_id,
        "phase": state_values.get("phase"),
        "error": state_values.get("error"),
        "log_tail": (state_values.get("log") or [])[-30:],
        "interrupt": interrupted,
    }
    _THREADS[thread_id] = payload
    return payload


def start_agent(
    project_id: str,
    *,
    thread_id: str | None = None,
    skip_outline_generate: bool = False,
    skip_fill: bool = False,
    background: bool = True,
) -> dict[str, Any]:
    P.project_dir(project_id)
    tid = _thread_key(project_id, thread_id)
    init: AgentState = {
        "project_id": project_id,
        "thread_id": tid,
        "phase": "start",
        "log": [f"agent start thread={tid}"],
        "error": None,
        "skip_outline_generate": skip_outline_generate,
        "skip_fill": skip_fill,
    }
    pending = {
        "ok": True,
        "status": "running",
        "thread_id": tid,
        "project_id": project_id,
        "phase": "start",
        "error": None,
        "log_tail": init["log"],
        "interrupt": None,
    }
    _THREADS[tid] = pending

    def _run() -> None:
        try:
            graph = get_graph()
            config = {"configurable": {"thread_id": tid}}
            result = graph.invoke(init, config=config)
            _snapshot(tid, project_id, result)
        except Exception as exc:  # noqa: BLE001
            _THREADS[tid] = {
                "ok": False,
                "status": "error",
                "thread_id": tid,
                "project_id": project_id,
                "phase": "error",
                "error": str(exc),
                "log_tail": list(init.get("log") or []) + [f"fatal:{exc}"],
                "interrupt": None,
            }

    if background:
        threading.Thread(target=_run, daemon=True).start()
        return pending
    _run()
    return _THREADS[tid]


def resume_agent(
    project_id: str,
    thread_id: str,
    *,
    user_choice: str = "确认",
    reason: str | None = None,
    outline_status: str | None = None,
    background: bool = True,
) -> dict[str, Any]:
    P.project_dir(project_id)
    resume_val = {
        "user_choice": user_choice,
        "reason": reason,
        "outline_status": outline_status or "user_confirmed",
    }
    prev = _THREADS.get(thread_id) or {
        "thread_id": thread_id,
        "project_id": project_id,
        "log_tail": [],
    }
    pending = {
        **prev,
        "ok": True,
        "status": "running",
        "phase": "resuming",
        "error": None,
        "interrupt": None,
        "log_tail": list(prev.get("log_tail") or []) + ["resume requested"],
    }
    _THREADS[thread_id] = pending

    def _run() -> None:
        try:
            graph = get_graph()
            config = {"configurable": {"thread_id": thread_id}}
            result = graph.invoke(Command(resume=resume_val), config=config)
            _snapshot(thread_id, project_id, result)
        except Exception as exc:  # noqa: BLE001
            _THREADS[thread_id] = {
                "ok": False,
                "status": "error",
                "thread_id": thread_id,
                "project_id": project_id,
                "phase": "error",
                "error": str(exc),
                "log_tail": list(pending.get("log_tail") or []) + [f"fatal:{exc}"],
                "interrupt": None,
            }

    if background:
        threading.Thread(target=_run, daemon=True).start()
        return pending
    _run()
    return _THREADS[thread_id]


def get_thread(thread_id: str) -> dict[str, Any] | None:
    return _THREADS.get(thread_id)


def list_threads(project_id: str | None = None) -> list[dict[str, Any]]:
    items = list(_THREADS.values())
    if project_id:
        items = [t for t in items if t.get("project_id") == project_id]
    return items
