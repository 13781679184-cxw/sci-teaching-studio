"""Studio AI copilot: outline structural edits + figure regen prompts."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import projects as P

INTENTS = frozenset(
    {
        "overview",
        "mechanism",
        "comparison",
        "scenario",
        "terms",
        "figure_reading",
        "misconception",
        "summary",
        "custom",
    }
)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _classic_teaching_prompt(purpose: str, *, focus: str | None = None) -> str:
    """Mirror deck classic_teaching_prompt without importing visuals (avoids PIL in API venv)."""
    purpose = (purpose or "").strip() or "本节知识点"
    focus = (focus or "").strip()
    parts = [f"教学示意图：说明「{purpose}」。"]
    if focus:
        parts.append(f"重点：{focus}。")
    parts.append(
        "纯白背景，严谨教材/期刊级扁平矢量。"
        "仅示意结构/流程，不出现定量结果、显微图、条带或未在证据中的结论。"
        "只画示意图本体，不要做成完整幻灯片：不要页眉大标题、左侧要点栏、页脚引用。"
        "图中不要出现操作指令、聊天原文、按钮文案或「继续生图」这类文字。"
    )
    return "".join(parts)


def _next_id(items: list[dict], prefix: str, field: str) -> str:
    max_n = 0
    for it in items or []:
        m = re.match(rf"^{re.escape(prefix)}(\d+)$", str(it.get(field) or ""), re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"{prefix}{max_n + 1:02d}"


def _next_beat_id(beats: list[dict], kp_id: str) -> str:
    max_n = 0
    for b in beats or []:
        m = re.search(r"B(\d+)$", str(b.get("beat_id") or ""), re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"{kp_id}-B{max_n + 1:02d}"


def _renumber(items: list[dict]) -> None:
    for i, it in enumerate(items or []):
        it["order"] = i + 1


def apply_outline_ops(outline: dict[str, Any], ops: list[dict[str, Any]]) -> list[str]:
    """Apply structured ops in-place. Returns human notes."""
    notes: list[str] = []
    sections = outline.setdefault("sections", [])

    def find_sec(sid: str):
        for s in sections:
            if s.get("section_id") == sid:
                return s
        return None

    def find_kp(kpid: str):
        for s in sections:
            for kp in s.get("knowledge_points") or []:
                if kp.get("kp_id") == kpid:
                    return s, kp
        return None, None

    for raw in ops or []:
        op = (raw.get("op") or "").strip()
        if op == "add_section":
            sid = _next_id(sections, "SEC", "section_id")
            kps_in = raw.get("knowledge_points") or []
            kps: list[dict] = []
            for i, kp_raw in enumerate(kps_in):
                all_kps = [k for s in sections for k in (s.get("knowledge_points") or [])] + kps
                kid = _next_id(all_kps, "KP", "kp_id")
                beats_in = kp_raw.get("beats") or kp_raw.get("teaching_beats") or []
                beats: list[dict] = []
                for j, br in enumerate(beats_in or [{"title": kp_raw.get("title") or "新页"}]):
                    if isinstance(br, str):
                        br = {"title": br}
                    bid = _next_beat_id(beats, kid)
                    intent = br.get("intent") if br.get("intent") in INTENTS else "custom"
                    beats.append(
                        {
                            "beat_id": bid,
                            "title": (br.get("title") or f"页 {j + 1}").strip(),
                            "intent": intent,
                            "order": j + 1,
                            "on_slide_points": list(br.get("on_slide_points") or ["要点 — 待补充"]),
                            "needs_figure": bool(br.get("needs_figure", True)),
                            "figure_hint": (br.get("figure_hint") or "").strip() or None,
                        }
                    )
                if not beats:
                    beats = [
                        {
                            "beat_id": _next_beat_id([], kid),
                            "title": (kp_raw.get("title") or "新页").strip(),
                            "intent": "overview",
                            "order": 1,
                            "on_slide_points": ["要点 — 待补充"],
                            "needs_figure": True,
                            "figure_hint": None,
                        }
                    ]
                kps.append(
                    {
                        "kp_id": kid,
                        "title": (kp_raw.get("title") or "新知识点").strip(),
                        "description": (kp_raw.get("description") or "").strip(),
                        "learning_objective": (kp_raw.get("learning_objective") or "能说明本知识点要点").strip(),
                        "order": i + 1,
                        "must_cover": True,
                        "teaching_beats": beats,
                    }
                )
            sections.append(
                {
                    "section_id": sid,
                    "title": (raw.get("title") or "新章节").strip(),
                    "order": len(sections) + 1,
                    "estimated_minutes": int(raw.get("estimated_minutes") or 8),
                    "knowledge_points": kps,
                }
            )
            _renumber(sections)
            notes.append(f"新增章节 {sid}「{raw.get('title') or '新章节'}」")
        elif op == "remove_section":
            sid = raw.get("section_id")
            before = len(sections)
            sections[:] = [s for s in sections if s.get("section_id") != sid]
            _renumber(sections)
            if len(sections) < before:
                notes.append(f"删除章节 {sid}")
            else:
                notes.append(f"未找到章节 {sid}")
        elif op == "add_kp":
            sid = raw.get("section_id")
            sec = find_sec(sid) if sid else (sections[-1] if sections else None)
            if not sec:
                notes.append("add_kp 失败：无章节")
                continue
            all_kps = [k for s in sections for k in (s.get("knowledge_points") or [])]
            kid = _next_id(all_kps, "KP", "kp_id")
            beats_in = raw.get("beats") or raw.get("teaching_beats") or [{"title": raw.get("title") or "新页"}]
            beats = []
            for j, br in enumerate(beats_in):
                if isinstance(br, str):
                    br = {"title": br}
                bid = _next_beat_id(beats, kid)
                intent = br.get("intent") if br.get("intent") in INTENTS else "custom"
                beats.append(
                    {
                        "beat_id": bid,
                        "title": (br.get("title") or f"页 {j + 1}").strip(),
                        "intent": intent,
                        "order": j + 1,
                        "on_slide_points": list(br.get("on_slide_points") or ["要点 — 待补充"]),
                        "needs_figure": bool(br.get("needs_figure", True)),
                        "figure_hint": (br.get("figure_hint") or "").strip() or None,
                    }
                )
            kps = sec.setdefault("knowledge_points", [])
            kps.append(
                {
                    "kp_id": kid,
                    "title": (raw.get("title") or "新知识点").strip(),
                    "description": (raw.get("description") or "").strip(),
                    "learning_objective": (raw.get("learning_objective") or "能说明本知识点要点").strip(),
                    "order": len(kps) + 1,
                    "must_cover": True,
                    "teaching_beats": beats,
                }
            )
            _renumber(kps)
            notes.append(f"在 {sec.get('section_id')} 下新增知识点 {kid}")
        elif op == "remove_kp":
            kpid = raw.get("kp_id")
            found = False
            for s in sections:
                kps = s.get("knowledge_points") or []
                n0 = len(kps)
                s["knowledge_points"] = [k for k in kps if k.get("kp_id") != kpid]
                if len(s["knowledge_points"]) < n0:
                    found = True
                    _renumber(s["knowledge_points"])
            notes.append(f"删除知识点 {kpid}" if found else f"未找到知识点 {kpid}")
        elif op == "add_beat":
            kpid = raw.get("kp_id")
            _, kp = find_kp(kpid)
            if not kp:
                notes.append(f"add_beat 失败：无 {kpid}")
                continue
            beats = kp.setdefault("teaching_beats", [])
            bid = _next_beat_id(beats, kpid)
            intent = raw.get("intent") if raw.get("intent") in INTENTS else "custom"
            beats.append(
                {
                    "beat_id": bid,
                    "title": (raw.get("title") or "新页").strip(),
                    "intent": intent,
                    "order": len(beats) + 1,
                    "on_slide_points": list(raw.get("on_slide_points") or ["要点 — 待补充"]),
                    "needs_figure": bool(raw.get("needs_figure", True)),
                    "figure_hint": (raw.get("figure_hint") or "").strip() or None,
                }
            )
            _renumber(beats)
            notes.append(f"在 {kpid} 下新增页 {bid}")
        elif op == "remove_beat":
            bid = raw.get("beat_id")
            found = False
            for s in sections:
                for kp in s.get("knowledge_points") or []:
                    beats = kp.get("teaching_beats") or []
                    n0 = len(beats)
                    kp["teaching_beats"] = [b for b in beats if b.get("beat_id") != bid]
                    if len(kp["teaching_beats"]) < n0:
                        found = True
                        _renumber(kp["teaching_beats"])
            notes.append(f"删除页 {bid}" if found else f"未找到页 {bid}")
        elif op == "rename":
            target = raw.get("target")  # section_id | kp_id | beat_id
            title = (raw.get("title") or "").strip()
            if not target or not title:
                continue
            for s in sections:
                if s.get("section_id") == target:
                    s["title"] = title
                    notes.append(f"重命名章节 {target}")
                    break
                for kp in s.get("knowledge_points") or []:
                    if kp.get("kp_id") == target:
                        kp["title"] = title
                        notes.append(f"重命名知识点 {target}")
                        break
                    for b in kp.get("teaching_beats") or []:
                        if b.get("beat_id") == target:
                            b["title"] = title
                            notes.append(f"重命名页 {target}")
                            break
        else:
            notes.append(f"忽略未知 op: {op}")
    outline["updated_at"] = _now()
    outline["status"] = "draft"
    return notes


OUTLINE_SYSTEM = """你是理工科课件大纲副驾。用户用中文提修改要求，你只输出一个 JSON 对象（不要 markdown）。

可用 op：
- add_section: {op, title, estimated_minutes?, knowledge_points:[{title, learning_objective?, beats:[{title, intent, on_slide_points, needs_figure, figure_hint}]}]}
- remove_section: {op, section_id}
- add_kp: {op, section_id?, title, learning_objective?, beats:[...]}
- remove_kp: {op, kp_id}
- add_beat: {op, kp_id, title, intent?, on_slide_points?, needs_figure?, figure_hint?}
- remove_beat: {op, beat_id}
- rename: {op, target, title}  // target 为 section_id / kp_id / beat_id

intent 只能是：overview|mechanism|comparison|scenario|terms|figure_reading|misconception|summary|custom
禁止创建「明确不讲什么」类内容。尽量少改：只输出完成用户意图所需的 ops。

输出形状：
{"summary":"一句话中文说明","ops":[...]}
"""


def edit_outline_with_copilot(project_id: str, message: str) -> dict[str, Any]:
    P._ensure_deck_on_path()
    from outline.llm import bailian_text_chat, extract_json_object  # noqa: WPS433

    message = (message or "").strip()
    if not message:
        raise ValueError("请输入要对大纲做什么")

    outline = P.load_json(project_id, "source/outline.json")
    slim = {
        "course_title": outline.get("course_title"),
        "audience": outline.get("audience"),
        "target_minutes": outline.get("target_minutes"),
        "sections": [],
    }
    for s in outline.get("sections") or []:
        slim["sections"].append(
            {
                "section_id": s.get("section_id"),
                "title": s.get("title"),
                "estimated_minutes": s.get("estimated_minutes"),
                "knowledge_points": [
                    {
                        "kp_id": kp.get("kp_id"),
                        "title": kp.get("title"),
                        "learning_objective": kp.get("learning_objective"),
                        "teaching_beats": [
                            {
                                "beat_id": b.get("beat_id"),
                                "title": b.get("title"),
                                "intent": b.get("intent"),
                            }
                            for b in (kp.get("teaching_beats") or [])
                        ],
                    }
                    for kp in (s.get("knowledge_points") or [])
                ],
            }
        )

    user_msg = (
        f"当前大纲（精简）：\n{json.dumps(slim, ensure_ascii=False)}\n\n"
        f"用户要求：{message}\n\n请输出 JSON。"
    )
    text = bailian_text_chat(system=OUTLINE_SYSTEM, message=user_msg, temperature=0.3)
    if not text:
        raise RuntimeError("大纲副驾调用失败（百炼 text chat 不可用）")
    parsed = extract_json_object(text)
    if not parsed or not isinstance(parsed.get("ops"), list):
        raise RuntimeError(f"模型未返回可用 ops：{(text or '')[:400]}")

    before = deepcopy(outline)
    notes = apply_outline_ops(outline, parsed["ops"])
    if not notes:
        raise RuntimeError("没有可执行的修改")

    P.save_json(project_id, "source/outline.json", outline)
    P.append_decision(
        project_id,
        {
            "gate": "gate1_outline",
            "actor": {"kind": "copilot", "name": "studio"},
            "action": "outline_edit",
            "user_choice": message,
            "reason": parsed.get("summary"),
            "before": {"section_count": len(before.get("sections") or [])},
            "after": {"section_count": len(outline.get("sections") or []), "notes": notes},
            "affected_entities": [],
            "invalidation_scope": ["sources", "figures", "slides"],
        },
    )
    return {
        "ok": True,
        "summary": parsed.get("summary") or "；".join(notes),
        "notes": notes,
        "outline": outline,
    }


def set_figure_regen_prompt(project_id: str, page_id: str, message: str) -> dict[str, Any]:
    """Write user NL into slide visual purpose + figure generation_spec, ready for fill --only.

    Descriptions are stored in prompt_history (for the input picker). The applied
    prompt is ephemeral: callers should restore defaults after fill via
    clear_figure_user_prompts so later regenerations are not polluted.
    """
    message = (message or "").strip()
    page_id = (page_id or "").strip()
    if not message:
        raise ValueError("请描述想要的图")
    if _is_visual_job_command(message):
        raise ValueError("这是操作指令，不是画面描述。请说「继续 AI 生图」走任务，或描述具体画面")
    if not page_id:
        raise ValueError("缺少 page_id")

    root = P.project_dir(project_id)
    plan_path = root / "source" / "slide_plan.json"
    if not plan_path.is_file():
        raise FileNotFoundError("slide_plan.json missing — 请先完成配图生成")

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    slide = None
    for s in plan.get("slides") or []:
        if s.get("page_id") == page_id:
            slide = s
            break
    if not slide:
        raise KeyError(f"page {page_id} not found")

    role = slide.get("page_role") or "content"
    if role in {"title", "agenda", "summary", "references"}:
        raise ValueError(f"{role} 页不配图，请选内容页")

    title = slide.get("page_title") or page_id
    prompt = _classic_teaching_prompt(message, focus=f"本页「{title}」")
    vp = slide.setdefault("visual_plan", {})
    # Keep originals so auto-restore after fill can recover.
    if not vp.get("base_purpose") and vp.get("purpose"):
        vp["base_purpose"] = vp["purpose"]
    vp["purpose"] = message
    vp["visual_type"] = "ai_scientific_illustration"
    vp["layout"] = vp.get("layout") or "figure_focus"
    if vp.get("resolution_status") == "not_needed":
        vp["resolution_status"] = "unresolved"

    history = _normalize_prompt_history(vp.get("prompt_history"))
    history = [h for h in history if h != message]
    history.insert(0, message)
    vp["prompt_history"] = history[:20]

    fid = vp.get("selected_figure_id")
    cat_path = root / "source" / "figure_catalog.json"
    if cat_path.is_file() and fid:
        cat = json.loads(cat_path.read_text(encoding="utf-8"))
        for fig in cat.get("figures") or []:
            if fig.get("figure_id") == fid:
                gs = fig.get("generation_spec")
                if not isinstance(gs, dict):
                    gs = {}
                    fig["generation_spec"] = gs
                if not gs.get("base_prompt_summary") and gs.get("prompt_summary"):
                    gs["base_prompt_summary"] = gs["prompt_summary"]
                gs["prompt_summary"] = prompt
                gs["model"] = None
                gs["user_instruction"] = message
                break
        cat_path.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    plan["updated_at"] = _now()
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "ok": True,
        "page_id": page_id,
        "prompt": prompt,
        "user_instruction": message,
        "prompt_history": history[:20],
        "summary": f"已记下配图要求，准备重跑 {page_id}",
    }


def _normalize_prompt_history(raw: Any) -> list[str]:
    out: list[str] = []
    for item in raw or []:
        if isinstance(item, str):
            t = item.strip()
        elif isinstance(item, dict):
            t = str(item.get("text") or "").strip()
        else:
            t = ""
        if t and t not in out:
            out.append(t)
    return out


def list_figure_prompt_history(project_id: str, page_id: str) -> dict[str, Any]:
    page_id = (page_id or "").strip()
    if not page_id:
        raise ValueError("缺少 page_id")
    root = P.project_dir(project_id)
    plan_path = root / "source" / "slide_plan.json"
    if not plan_path.is_file():
        return {"page_id": page_id, "history": []}
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    for s in plan.get("slides") or []:
        if s.get("page_id") == page_id:
            vp = s.get("visual_plan") or {}
            return {
                "page_id": page_id,
                "history": _normalize_prompt_history(vp.get("prompt_history")),
            }
    raise KeyError(f"page {page_id} not found")


def _recover_topic_for_figure(fig: dict[str, Any], slide: dict[str, Any] | None) -> str:
    """Best-effort topic after clearing polluted user_instruction."""
    vp = (slide or {}).get("visual_plan") or {}
    if vp.get("base_purpose"):
        return str(vp["base_purpose"]).strip()
    gs = fig.get("generation_spec") or {}
    base = (gs.get("base_prompt_summary") or "").strip()
    if base:
        # Pull 「…」 topic out of classic_teaching_prompt if present.
        m = re.search(r"说明「(.+?)」", base)
        if m:
            return m.group(1).strip()
    panels = fig.get("panel_explanations") or []
    if panels and panels[0].get("explanation"):
        return str(panels[0]["explanation"]).strip()
    title = (slide or {}).get("page_title") or fig.get("figure_id") or "教学示意"
    return f"支撑「{title}」的核心概念示意图"


def clear_figure_user_prompts(
    project_id: str,
    *,
    page_id: str | None = None,
    all_pages: bool = False,
) -> dict[str, Any]:
    """Strip copilot user_instruction and restore default teaching prompts.

    Use when NL descriptions polluted later regenerations. Does not delete image files;
    call fill --only afterwards if you want a fresh image with the cleaned prompt.
    """
    page_id = (page_id or "").strip() or None
    if not page_id and not all_pages:
        raise ValueError("请指定 page_id，或传 all_pages=true 清除全部口述污染")

    root = P.project_dir(project_id)
    plan_path = root / "source" / "slide_plan.json"
    cat_path = root / "source" / "figure_catalog.json"
    if not plan_path.is_file():
        raise FileNotFoundError("slide_plan.json missing")
    if not cat_path.is_file():
        raise FileNotFoundError("figure_catalog.json missing")

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    cat = json.loads(cat_path.read_text(encoding="utf-8"))
    figs_by_id = {f.get("figure_id"): f for f in (cat.get("figures") or []) if f.get("figure_id")}

    target_slides: list[dict[str, Any]] = []
    for s in plan.get("slides") or []:
        if all_pages:
            target_slides.append(s)
        elif page_id and s.get("page_id") == page_id:
            target_slides.append(s)

    if page_id and not target_slides:
        raise KeyError(f"page {page_id} not found")

    cleared: list[str] = []
    for slide in target_slides:
        vp = slide.get("visual_plan") or {}
        fid = vp.get("selected_figure_id")
        fig = figs_by_id.get(fid) if fid else None
        gs = (fig or {}).get("generation_spec") if fig else None
        had_user = bool(isinstance(gs, dict) and gs.get("user_instruction"))
        purpose_was_user = bool(
            had_user
            and isinstance(gs, dict)
            and vp.get("purpose")
            and vp.get("purpose") == gs.get("user_instruction")
        )
        if not had_user:
            # Single-page clear may still rebuild from saved base_*; all_pages only touches polluted.
            if all_pages:
                continue
            if not (isinstance(gs, dict) and (gs.get("base_prompt_summary") or vp.get("base_purpose"))):
                continue

        if fig is None:
            if purpose_was_user or vp.get("base_purpose"):
                if vp.get("base_purpose"):
                    vp["purpose"] = vp["base_purpose"]
                slide["visual_plan"] = vp
            continue

        gs = fig.get("generation_spec")
        if not isinstance(gs, dict):
            gs = {}
            fig["generation_spec"] = gs
        topic = _recover_topic_for_figure(fig, slide)
        title = slide.get("page_title") or slide.get("page_id") or fid
        if gs.get("base_prompt_summary") and not purpose_was_user and not had_user:
            prompt = gs["base_prompt_summary"]
        else:
            prompt = _classic_teaching_prompt(topic, focus=f"本页「{title}」")

        gs.pop("user_instruction", None)
        gs["prompt_summary"] = prompt
        gs["model"] = None

        if vp.get("base_purpose"):
            vp["purpose"] = vp["base_purpose"]
        elif purpose_was_user or had_user:
            vp["purpose"] = topic
        slide["visual_plan"] = vp
        cleared.append(slide.get("page_id") or fid)

    # Also strip orphan user_instruction on figures not currently selected (all_pages).
    if all_pages:
        selected = {
            (s.get("visual_plan") or {}).get("selected_figure_id")
            for s in (plan.get("slides") or [])
        }
        for fig in cat.get("figures") or []:
            fid = fig.get("figure_id")
            gs = fig.get("generation_spec") or {}
            if not gs.get("user_instruction"):
                continue
            if fid in selected:
                continue
            topic = _recover_topic_for_figure(fig, None)
            gs.pop("user_instruction", None)
            if gs.get("base_prompt_summary"):
                gs["prompt_summary"] = gs["base_prompt_summary"]
            else:
                gs["prompt_summary"] = _classic_teaching_prompt(topic)
            gs["model"] = None
            fig["generation_spec"] = gs
            cleared.append(fid)

    plan["updated_at"] = _now()
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cat_path.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {
        "ok": True,
        "cleared": cleared,
        "count": len(cleared),
        "summary": (
            f"已清除 {len(cleared)} 处口述描述，恢复默认教学 prompt"
            if cleared
            else "没有发现口述污染"
        ),
    }


# —— Studio rail copilot (context by screen) ——————————————————————————————

_NO_FIG_ROLES = frozenset({"title", "agenda", "section", "summary", "references", "thanks"})

LECTURE_EDIT_SYSTEM = """你是课件讲稿编辑助手。用户会给出某一页的口播稿与修改要求。
只输出 JSON：{"summary":"一句话中文","body":"改写后的口播全文（不要标题行）"}
保持教学语气、口语化；不要编造幻灯片上没有的流程图/图表说明，除非用户明确要求。
"""


def _parse_lecture_sections(md: str) -> tuple[str, list[dict[str, str]]]:
    """Split lecture_script.md into preamble + [{page_id, title, body}]."""
    text = (md or "").replace("\r\n", "\n")
    lines = text.split("\n")
    preamble_lines: list[str] = []
    sections: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    body: list[str] = []
    heading = re.compile(r"^##\s+(P?\d+)\s*(.*)$", re.I)

    def flush() -> None:
        nonlocal cur, body
        if cur is not None:
            cur["body"] = "\n".join(body).strip()
            sections.append(cur)
        cur = None
        body = []

    for line in lines:
        m = heading.match(line.strip())
        if m:
            flush()
            pid = m.group(1).upper()
            if not pid.startswith("P"):
                pid = f"P{pid.zfill(2)}" if pid.isdigit() else pid
            cur = {"page_id": pid, "title": (m.group(2) or "").strip()}
            body = []
            continue
        if cur is None:
            preamble_lines.append(line)
        else:
            body.append(line)
    flush()
    preamble = "\n".join(preamble_lines).strip()
    return preamble, sections


def _write_lecture_md(preamble: str, sections: list[dict[str, str]]) -> str:
    parts: list[str] = []
    if preamble:
        parts.append(preamble.rstrip())
        parts.append("")
    else:
        parts.extend(["# 配套讲稿（lecture_script）", "", "---", ""])
    for s in sections:
        pid = s.get("page_id") or ""
        title = s.get("title") or ""
        parts.append(f"## {pid} {title}".rstrip())
        parts.append("")
        body = (s.get("body") or "").strip()
        if body:
            parts.append(body)
            parts.append("")
        parts.append("---")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def _content_page_ids(project_id: str) -> list[str]:
    root = P.project_dir(project_id)
    plan_path = root / "source" / "slide_plan.json"
    if not plan_path.is_file():
        return []
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    out: list[str] = []
    for s in plan.get("slides") or []:
        role = s.get("page_role") or "content"
        pid = s.get("page_id")
        if pid and role not in _NO_FIG_ROLES:
            out.append(str(pid))
    return out


def _wants_batch(message: str) -> bool:
    return any(k in message for k in ("全部", "批量", "所有页", "每一页", "整套", "统一"))


def _wants_lecture(message: str) -> bool:
    return any(k in message for k in ("讲稿", "口播", "台词", "旁白", "口述稿"))


def _compact_zh(message: str) -> str:
    return re.sub(r"[\s\u3000，。！？、；：,.!?;:\"'“”‘’（）()【】\[\]]+", "", message or "")


def _is_visual_job_command(message: str) -> bool:
    """True when the user is asking to run crop/fill, not describing a diagram."""
    compact = _compact_zh(message)
    if not compact:
        return False
    low = compact.lower()
    exact = {
        "继续ai生图",
        "继续生图",
        "继续配图",
        "继续补图",
        "继续裁图",
        "接着生图",
        "接着配图",
        "接着补图",
        "再生成图",
        "再生图",
        "ai生图",
        "仅ai生图",
        "只ai生图",
        "仅生图",
        "补图",
        "跑ai",
        "跑生图",
        "生图",
        "配图",
        "一键配图",
        "仅论文裁图",
        "仅裁图",
        "裁论文图",
        "只裁论文图",
        "继续裁论文图",
        "fill",
        "crop",
    }
    if low in exact or compact in exact:
        return True
    if re.fullmatch(
        r"(请|麻烦)?(继续|开始|接着|再|再来|帮我|给我)?(做|跑|来)?(一下|下)?"
        r"(ai|人工智能)?"
        r"(生图|配图|补图|裁图|一键配图|论文裁图)",
        compact,
        flags=re.I,
    ):
        return True
    if "继续" in compact and any(k in compact for k in ("生图", "配图", "补图", "裁图", "ai")):
        return True
    return False


def _visual_job_intent(message: str) -> str | None:
    """Return crop | fill | fill_skip_resolved | pipeline | None."""
    if not _is_visual_job_command(message):
        return None
    compact = _compact_zh(message).lower()
    if any(k in compact for k in ("一键配图", "全流程", "整套配图")):
        return "pipeline"
    if any(k in compact for k in ("裁图", "裁论文", "论文裁")) and "生图" not in compact:
        return "crop"
    if any(k in compact for k in ("继续", "接着", "再", "未完成", "剩下", "剩余")):
        return "fill_skip_resolved"
    return "fill"


def _extract_limit(message: str, default: int, *, hard_max: int = 20) -> tuple[int, int | None]:
    """Parse N篇 / 至少N; return (clamped_limit, raw_requested_or_None)."""
    requested: int | None = None
    m = re.search(r"(?:至少|最少|不少于|大概|大约|约)?\s*(\d+)\s*篇", message)
    if m:
        requested = int(m.group(1))
    else:
        m = re.search(r"(?:只要|留到?|找|检(?:索)?)\s*(\d+)", message)
        if m:
            requested = int(m.group(1))
    if requested is None:
        return default, None
    return max(1, min(hard_max, requested)), requested


def _sources_copilot(project_id: str, message: str) -> dict[str, Any]:
    del project_id  # reserved for future pack-aware routing
    msg = message.strip()

    if any(k in msg for k in ("采纳", "确认文献", "只留保留", "收下", "全部选用")):
        return {
            "ok": True,
            "summary": "将采纳「保留 / 待定」档文献",
            "actions": [{"type": "run_step", "step": "confirm_sources"}],
        }
    if any(k in msg for k in ("重筛", "再筛", "初筛")) and not any(
        k in msg for k in ("检索", "找", "搜", "多")
    ):
        return {
            "ok": True,
            "summary": "重新初筛候选文献",
            "actions": [{"type": "run_step", "step": "screen"}],
        }

    fewer = any(k in msg for k in ("少点", "少几", "精简", "砍", "太多", "减少", "少留", "少找"))
    more = any(
        k in msg
        for k in (
            "更多",
            "多点",
            "多几",
            "多找",
            "再找",
            "再检",
            "加几",
            "不够",
            "再来",
            "找几",
            "多一点",
            "多一些",
        )
    )
    has_count = bool(re.search(r"\d+\s*篇", msg)) or bool(re.search(r"至少\s*\d+", msg))
    findish = any(k in msg for k in ("找", "搜", "检索", "文献", "论文", "再来点"))

    if fewer:
        limit, requested = _extract_limit(msg, 2, hard_max=12)
        note = f"（你提到 {requested} 篇）" if requested and requested != limit else ""
        return {
            "ok": True,
            "summary": f"将按约 {limit} 篇重新检索并初筛{note}",
            "actions": [{"type": "run_step", "step": "retrieve_screen", "extra": {"limit": limit}}],
        }

    if more or has_count or findish:
        default = 8 if more else 5
        limit, requested = _extract_limit(msg, default, hard_max=20)
        if requested and requested > limit:
            summary = (
                f"收到，你希望至少 {requested} 篇；"
                f"单次检索先按每知识点每通道最多 {limit} 篇拉取并初筛（避免一次过慢），"
                f"不够可以再说「再多找一些」。"
            )
        else:
            summary = f"好的，开始按约 {limit} 篇重新检索并初筛"
        return {
            "ok": True,
            "summary": summary,
            "actions": [{"type": "run_step", "step": "retrieve_screen", "extra": {"limit": limit}}],
        }

    return {
        "ok": True,
        "summary": "可以说「多找几篇」「至少 10 篇」「少点只要 2 篇」或「全部选用」",
        "actions": [],
    }


FIGURES_INTENT_SYSTEM = """你是理工科课件「配图」副驾。先理解用户意图，再决定怎么做。只输出一个 JSON（不要 markdown）。

intent 只能是其一：
- continue_ai：继续/开始为未完成页做 AI 生图（操作任务，不是画面描述）
- fill_all：重跑/重做全部 AI 图
- crop：仅论文裁图
- pipeline：一键配图（全流程）
- describe：用户在描述想改的画面内容或风格
- help：无法判断，给简短引导

scope（describe 时）：
- page：只改当前选中页
- batch：全部内容页
- need_page：要改画面但没选页、也没说全部

规则（很重要）：
1. 「继续生图」「继续 AI 生图」「补图」「再生成」「跑一下生图」→ continue_ai。
   这些是操作指令，绝不能写进画面，也绝不能原样放进 visual_purpose。
2. describe 时必须填写 visual_purpose：把用户话改写成「这页教学示意图应画什么」的客观短句。
   - 要具体（结构/流程/对比/标注），去掉聊天语气、口头禅、操作指令。
   - 禁止照抄用户原话；禁止出现「继续生图」「帮我改」「请」等。
3. 用户只说风格（如「都改成白底手绘」）且带「全部/所有/统一」→ describe + batch。
4. 没有选中页、用户也没说全部，却像在改某一页画面 → need_page。

输出形状：
{
  "intent": "continue_ai|fill_all|crop|pipeline|describe|help",
  "scope": "page|batch|need_page|unresolved",
  "visual_purpose": null或改写后的画面描述,
  "summary": "给用户看的一句话中文回复"
}
"""


def _heuristic_figures_intent(message: str) -> dict[str, Any] | None:
    """Cheap keyword fallback when LLM unavailable."""
    intent = _visual_job_intent(message)
    if not intent:
        return None
    mapping = {
        "crop": "crop",
        "pipeline": "pipeline",
        "fill_skip_resolved": "continue_ai",
        "fill": "fill_all",
    }
    return {
        "intent": mapping.get(intent, "continue_ai"),
        "scope": "unresolved",
        "visual_purpose": None,
        "summary": None,
    }


def _classify_figures_intent(
    message: str,
    *,
    page_id: str | None,
    page_title: str | None = None,
) -> dict[str, Any]:
    """LLM-first intent parse; heuristic fallback."""
    msg = (message or "").strip()
    # Ultra-clear job commands: skip LLM to save tokens / latency
    fast = _heuristic_figures_intent(msg)
    if fast and _is_visual_job_command(msg) and len(_compact_zh(msg)) <= 16:
        fast["summary"] = {
            "crop": "好的，开始仅论文裁图",
            "pipeline": "好的，开始一键配图",
            "continue_ai": "好的，继续为未完成页做 AI 生图",
            "fill_all": "好的，开始 AI 生图",
        }.get(fast["intent"], "好的")
        return fast

    try:
        P._ensure_deck_on_path()
        from outline.llm import bailian_text_chat, extract_json_object  # noqa: WPS433

        user_msg = (
            f"当前选中页：{page_id or '无'}{('（' + page_title + '）') if page_title else ''}\n"
            f"用户说：{msg}\n\n请判断意图并输出 JSON。"
        )
        text = bailian_text_chat(system=FIGURES_INTENT_SYSTEM, message=user_msg, temperature=0.1)
        parsed = extract_json_object(text) if text else None
        if isinstance(parsed, dict) and parsed.get("intent"):
            intent = str(parsed.get("intent") or "help").strip()
            scope = str(parsed.get("scope") or "unresolved").strip()
            purpose = parsed.get("visual_purpose")
            if isinstance(purpose, str):
                purpose = purpose.strip() or None
            else:
                purpose = None
            # Safety: never allow job-command text as purpose
            if purpose and _is_visual_job_command(purpose):
                purpose = None
                if intent == "describe":
                    intent = "continue_ai"
            if intent == "describe" and not purpose:
                # Model failed to rewrite — do not dump raw chat into image prompt
                intent = "help"
            return {
                "intent": intent,
                "scope": scope,
                "visual_purpose": purpose,
                "summary": (parsed.get("summary") or "").strip() or None,
            }
    except Exception:
        pass

    if fast:
        fast["summary"] = fast.get("summary") or "好的，按操作任务处理"
        return fast
    return {
        "intent": "help",
        "scope": "need_page" if not page_id else "page",
        "visual_purpose": None,
        "summary": "可以说「继续 AI 生图」，或到预览选一页后描述想改的画面",
    }


def _scrub_meta_command_prompts(project_id: str) -> int:
    """If purpose/user_instruction is a job command (e.g. 继续AI生图), restore defaults."""
    root = P.project_dir(project_id)
    plan_path = root / "source" / "slide_plan.json"
    cat_path = root / "source" / "figure_catalog.json"
    if not plan_path.is_file():
        return 0
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    figures_doc = None
    figures_by_id: dict[str, dict[str, Any]] = {}
    if cat_path.is_file():
        figures_doc = json.loads(cat_path.read_text(encoding="utf-8"))
        figures_by_id = {
            f.get("figure_id"): f for f in (figures_doc.get("figures") or []) if f.get("figure_id")
        }

    cleared = 0
    for slide in plan.get("slides") or []:
        vp = slide.get("visual_plan")
        if not isinstance(vp, dict):
            continue
        purpose = (vp.get("purpose") or "").strip()
        dirty = _is_visual_job_command(purpose)
        fid = vp.get("selected_figure_id")
        fig = figures_by_id.get(fid) if fid else None
        gs = (fig or {}).get("generation_spec") if isinstance(fig, dict) else None
        if isinstance(gs, dict):
            ui = (gs.get("user_instruction") or "").strip()
            if _is_visual_job_command(ui):
                dirty = True
            ps = (gs.get("prompt_summary") or "")
            if "继续" in ps and ("生图" in ps or "配图" in ps):
                dirty = True
        if not dirty:
            continue
        title = slide.get("page_title") or slide.get("page_id") or ""
        topic = (vp.get("base_purpose") or title or "本节知识点").strip()
        if isinstance(gs, dict) and (gs.get("base_prompt_summary") or "").strip():
            prompt = gs["base_prompt_summary"]
        else:
            prompt = _classic_teaching_prompt(topic, focus=f"本页「{title}」" if title else None)
        if vp.get("base_purpose"):
            vp["purpose"] = vp["base_purpose"]
        else:
            vp["purpose"] = topic
        hist = _normalize_prompt_history(vp.get("prompt_history"))
        vp["prompt_history"] = [h for h in hist if not _is_visual_job_command(h)]
        if isinstance(gs, dict):
            gs.pop("user_instruction", None)
            gs["prompt_summary"] = prompt
            gs["model"] = None
        cleared += 1

    if cleared:
        plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if figures_doc is not None:
            cat_path.write_text(
                json.dumps(figures_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
    return cleared


def _run_visual_job_from_intent(project_id: str, intent: str, summary: str | None) -> dict[str, Any]:
    scrubbed = _scrub_meta_command_prompts(project_id)
    try:
        clear_figure_user_prompts(project_id, all_pages=True)
    except Exception:
        pass
    note = f"（已清掉 {scrubbed} 处误写入的指令文案）" if scrubbed else ""
    if intent == "crop":
        return {
            "ok": True,
            "summary": (summary or "好的，开始仅论文裁图") + note,
            "actions": [{"type": "run_step", "step": "crop"}],
        }
    if intent == "pipeline":
        return {
            "ok": True,
            "summary": (summary or "好的，开始一键配图") + note,
            "actions": [{"type": "run_step", "step": "run_default_pipeline"}],
        }
    if intent == "continue_ai":
        return {
            "ok": True,
            "summary": (summary or "好的，继续为未完成页做 AI 生图") + note,
            "actions": [{"type": "run_step", "step": "fill_skip_resolved"}],
        }
    # fill_all
    return {
        "ok": True,
        "summary": (summary or "好的，开始 AI 生图") + note,
        "actions": [{"type": "run_step", "step": "fill"}],
    }


def _page_title(project_id: str, page_id: str | None) -> str | None:
    if not page_id:
        return None
    try:
        plan = P.load_json(project_id, "source/slide_plan.json")
    except FileNotFoundError:
        return None
    for s in plan.get("slides") or []:
        if s.get("page_id") == page_id:
            return (s.get("page_title") or "").strip() or None
    return None


def _figures_copilot(
    project_id: str,
    message: str,
    page_id: str | None,
) -> dict[str, Any]:
    msg = (message or "").strip()
    title = _page_title(project_id, page_id)
    parsed = _classify_figures_intent(msg, page_id=page_id, page_title=title)
    intent = parsed.get("intent") or "help"
    scope = parsed.get("scope") or "unresolved"
    summary = parsed.get("summary")

    if intent in {"continue_ai", "fill_all", "crop", "pipeline"}:
        return _run_visual_job_from_intent(project_id, intent, summary)

    if intent == "describe":
        purpose = (parsed.get("visual_purpose") or "").strip()
        if not purpose or _is_visual_job_command(purpose):
            return {
                "ok": True,
                "summary": summary
                or "我理解你想改画面，但请说具体画什么（例如「漏斗分四段并标注数量」）",
                "actions": [],
            }
        if scope == "batch" or _wants_batch(msg):
            page_ids = _content_page_ids(project_id)
        elif page_id and scope != "need_page":
            page_ids = [page_id]
        else:
            return {
                "ok": True,
                "summary": summary
                or "改画面请先到「预览」选一页；批量改请加「全部」。直接生图可以说「继续 AI 生图」",
                "actions": [],
            }
        return _apply_figure_purpose(project_id, purpose, page_ids, summary=summary)

    return {
        "ok": True,
        "summary": summary
        or "可以说「继续 AI 生图」「仅论文裁图」，或选一页后描述想要的画面",
        "actions": [],
    }


def _apply_figure_purpose(
    project_id: str,
    purpose: str,
    page_ids: list[str],
    *,
    summary: str | None = None,
) -> dict[str, Any]:
    applied: list[str] = []
    errors: list[str] = []
    for pid in page_ids:
        try:
            set_figure_regen_prompt(project_id, pid, purpose)
            applied.append(pid)
        except (ValueError, KeyError, FileNotFoundError) as exc:
            errors.append(f"{pid}: {exc}")

    if not applied:
        raise ValueError("没有可改的配图页：" + ("；".join(errors) if errors else "请先完成配图规划"))

    return {
        "ok": True,
        "summary": summary or f"已为 {len(applied)} 页改写配图要求并准备重生",
        "page_ids": applied,
        "visual_purpose": purpose,
        "actions": [{"type": "run_step", "step": "fill", "extra": {"only": applied}}],
    }


def _batch_figure_copilot(
    project_id: str,
    message: str,
    page_id: str | None,
) -> dict[str, Any]:
    """Preview-screen entry: same intent router as figures."""
    return _figures_copilot(project_id, message, page_id)


def edit_lecture_with_copilot(
    project_id: str,
    message: str,
    page_id: str | None = None,
) -> dict[str, Any]:
    P._ensure_deck_on_path()
    from outline.llm import bailian_text_chat, extract_json_object  # noqa: WPS433

    msg = (message or "").strip()
    if not msg:
        raise ValueError("请说明要怎么改讲稿")

    root = P.project_dir(project_id)
    path = root / "lecture_script.md"
    if not path.is_file():
        raise FileNotFoundError("lecture_script.md missing — 请先在预览页生成讲稿")

    preamble, sections = _parse_lecture_sections(path.read_text(encoding="utf-8"))
    if not sections:
        raise ValueError("讲稿为空或格式无法解析")

    # Resolve target page
    target_id = (page_id or "").strip()
    if target_id and not target_id.upper().startswith("P"):
        # allow raw slide page_id like slide_03 → try match by index later
        pass
    target = None
    if target_id:
        tid = target_id.upper()
        for s in sections:
            if s["page_id"].upper() == tid or s["page_id"].upper() == f"P{tid}":
                target = s
                break
        if target is None:
            # map slide_NN → PNN via slide_plan order
            plan_path = root / "source" / "slide_plan.json"
            if plan_path.is_file():
                plan = json.loads(plan_path.read_text(encoding="utf-8"))
                slides = plan.get("slides") or []
                for i, sl in enumerate(slides):
                    if sl.get("page_id") == page_id:
                        want = f"P{i + 1:02d}"
                        for s in sections:
                            if s["page_id"].upper() == want:
                                target = s
                                break
                        break
    if target is None and not _wants_batch(msg):
        target = sections[0]

    if target is None or _wants_batch(msg):
        # Batch: apply same NL instruction page-by-page (cap to avoid long runs)
        changed = 0
        notes: list[str] = []
        for s in sections[:12]:
            user_msg = (
                f"页码 {s['page_id']} 标题：{s.get('title') or ''}\n"
                f"当前口播：\n{s.get('body') or '（空）'}\n\n"
                f"用户要求：{msg}\n请输出 JSON。"
            )
            text = bailian_text_chat(system=LECTURE_EDIT_SYSTEM, message=user_msg, temperature=0.35)
            parsed = extract_json_object(text or "") if text else None
            body = (parsed or {}).get("body") if isinstance(parsed, dict) else None
            if isinstance(body, str) and body.strip():
                s["body"] = body.strip()
                changed += 1
                if parsed.get("summary"):
                    notes.append(str(parsed["summary"]))
        if not changed:
            raise RuntimeError("讲稿批量改写失败（模型未返回可用内容）")
        path.write_text(_write_lecture_md(preamble, sections), encoding="utf-8")
        return {
            "ok": True,
            "summary": f"已改写 {changed} 页讲稿" + (f"：{notes[0]}" if notes else ""),
            "lecture_script": path.read_text(encoding="utf-8"),
            "actions": [],
        }

    user_msg = (
        f"页码 {target['page_id']} 标题：{target.get('title') or ''}\n"
        f"当前口播：\n{target.get('body') or '（空）'}\n\n"
        f"用户要求：{msg}\n请输出 JSON。"
    )
    text = bailian_text_chat(system=LECTURE_EDIT_SYSTEM, message=user_msg, temperature=0.35)
    if not text:
        raise RuntimeError("讲稿副驾调用失败（百炼 text chat 不可用）")
    parsed = extract_json_object(text)
    body = (parsed or {}).get("body") if isinstance(parsed, dict) else None
    if not isinstance(body, str) or not body.strip():
        raise RuntimeError(f"模型未返回可用讲稿：{(text or '')[:400]}")
    target["body"] = body.strip()
    path.write_text(_write_lecture_md(preamble, sections), encoding="utf-8")
    return {
        "ok": True,
        "summary": (parsed or {}).get("summary") or f"已更新 {target['page_id']} 讲稿",
        "lecture_script": path.read_text(encoding="utf-8"),
        "page_id": target["page_id"],
        "actions": [],
    }


def handle_studio_copilot(
    project_id: str,
    screen: str,
    message: str,
    page_id: str | None = None,
) -> dict[str, Any]:
    """Route rail AI copilot by current studio screen."""
    screen = (screen or "").strip().lower()
    message = (message or "").strip()
    page_id = (page_id or "").strip() or None
    if not message:
        raise ValueError("请输入要对副驾说的话")

    if screen == "outline":
        return edit_outline_with_copilot(project_id, message)

    if screen == "sources":
        return _sources_copilot(project_id, message)

    if screen == "figures":
        return _figures_copilot(project_id, message, page_id)

    if screen in {"preview", "complete"}:
        if _wants_lecture(message):
            return edit_lecture_with_copilot(project_id, message, page_id)
        return _figures_copilot(project_id, message, page_id)

    if screen == "theme":
        return {
            "ok": True,
            "summary": "请在版式页选择主题色，点下一步继续",
            "actions": [],
        }

    return {
        "ok": True,
        "summary": "当前步骤暂不支持副驾，请先进入大纲、文献、配图或完成页",
        "actions": [],
    }
