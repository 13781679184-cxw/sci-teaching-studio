"""Project filesystem helpers for sci-teaching-studio."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def deck_root() -> Path:
    env = os.environ.get("SCI_TEACHING_DECK_ROOT")
    if env:
        return Path(env).resolve()
    # sibling of sci-teaching-studio
    return Path(__file__).resolve().parents[2] / "sci-teaching-deck"


def workspace_root() -> Path:
    env = os.environ.get("SCI_TEACHING_WORKSPACE")
    if env:
        p = Path(env).resolve()
    else:
        p = Path(__file__).resolve().parents[1] / "workspace"
    p.mkdir(parents=True, exist_ok=True)
    return p


def python_exe() -> Path:
    env = os.environ.get("SCI_TEACHING_PYTHON")
    if env:
        return Path(env)
    venv = deck_root() / ".venv" / "Scripts" / "python.exe"
    if venv.is_file():
        return venv
    venv_unix = deck_root() / ".venv" / "bin" / "python"
    if venv_unix.is_file():
        return venv_unix
    return Path(os.environ.get("PYTHON", "python"))


def project_dir(project_id: str) -> Path:
    if not SLUG_RE.match(project_id):
        raise ValueError(f"invalid project_id: {project_id}")
    # Prefer workspace; fall back to deck uat/<id>
    ws = workspace_root() / project_id
    if ws.is_dir():
        return ws
    uat = deck_root() / "uat" / project_id
    if uat.is_dir():
        return uat
    raise FileNotFoundError(project_id)


# UAT folders under sci-teaching-deck/uat — only these appear in the studio sidebar.
# Other UATs stay on disk for engine tests; they are not product demos.
UAT_SIDEBAR = frozenset({"ai-peptide-seq-generation"})


def list_projects() -> list[dict[str, Any]]:
    found: dict[str, Path] = {}
    ws_root = workspace_root()
    uat_root = deck_root() / "uat"
    for base in (ws_root, uat_root):
        if not base.is_dir():
            continue
        is_uat = base.resolve() == uat_root.resolve()
        for child in base.iterdir():
            if not child.is_dir():
                continue
            if is_uat and child.name not in UAT_SIDEBAR:
                continue
            if (child / "source" / "outline.json").is_file() or (child / "source" / "project_brief.md").is_file():
                # workspace wins over uat when same id
                if child.name not in found or not is_uat:
                    found[child.name] = child
    out = []
    for pid, path in sorted(found.items()):
        outline = {}
        op = path / "source" / "outline.json"
        if op.is_file():
            try:
                outline = json.loads(op.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                outline = {}
        final = path / "deck" / "final.pptx"
        out.append(
            {
                "id": pid,
                "path": str(path),
                "course_title": outline.get("course_title") or outline.get("subject") or pid,
                "status": outline.get("status"),
                "has_final": final.is_file(),
                "location": "workspace" if path.parent.resolve() == ws_root.resolve() else "uat",
            }
        )
    return out


def _short_title(text: str, limit: int = 48) -> str:
    """First non-empty line, trimmed; long pastes don't become the whole course_title."""
    for line in (text or "").splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s if len(s) <= limit else s[: limit - 1] + "…"
    return "未命名课件"


def zh_figure_id(figure_id: str | None) -> str:
    """F007 → 图库 F007（编号是资产序号，不是 PPT 页码）."""
    s = str(figure_id or "").strip()
    if not s:
        return "图库"
    m = re.match(r"^F0*(\d+)$", s, re.I)
    if m:
        return f"图库 F{int(m.group(1)):03d}"
    return f"图库 {s}"


def zh_paper_figure_label(label: str | None) -> str | None:
    """Figure 3 / Fig. 3 → 图 3."""
    s = str(label or "").strip()
    if not s:
        return None
    m = re.match(r"^(?:Fig(?:ure)?\.?|图)\s*([A-Za-z]?\d[\w.\-]*)\s*$", s, re.I)
    if m:
        return f"图 {m.group(1)}"
    m = re.match(r"^(?:Fig(?:ure)?\.?)\s*(.+)$", s, re.I)
    if m:
        return f"图 {m.group(1).strip()}"
    if s.startswith("图"):
        return s
    return s


def zh_figure_kind(kind: str | None) -> str:
    return {
        "source_crop": "论文裁图",
        "ai_scientific_illustration": "AI 示意图",
        "adapted_diagram": "改编示意图",
        "table": "表格",
        "photo": "照片",
    }.get(str(kind or ""), str(kind or "未分类"))


def ui_figure_caption(
    *,
    caption_zh: str | None,
    caption_en: str | None,
    label: str | None,
) -> str:
    """Prefer Chinese caption for studio UI."""
    zh = (caption_zh or "").strip()
    if zh:
        return zh[:800]
    en = (caption_en or "").strip()
    if en and re.search(r"[\u4e00-\u9fff]", en):
        return en[:800]
    if en:
        return en[:800]  # temporary until translate endpoint fills caption_zh
    return zh_paper_figure_label(label) or ""


def _ensure_deck_on_path() -> Path:
    root = deck_root()
    s = str(root)
    if s not in sys.path:
        sys.path.insert(0, s)
    return root


def delete_figure(project_id: str, figure_id: str) -> dict[str, Any]:
    """Remove a figure from catalog, unlink slide bindings, and delete image files if present."""
    root = project_dir(project_id)
    cat_path = root / "source" / "figure_catalog.json"
    if not cat_path.is_file():
        raise FileNotFoundError("figure_catalog.json")
    doc = json.loads(cat_path.read_text(encoding="utf-8"))
    figures = list(doc.get("figures") or [])
    target = None
    kept: list[dict[str, Any]] = []
    for fig in figures:
        if fig.get("figure_id") == figure_id:
            target = fig
        else:
            kept.append(fig)
    if target is None:
        raise KeyError(figure_id)

    removed_files: list[str] = []
    crop = target.get("crop") or {}
    for rel in (target.get("file_path"), crop.get("safe_path"), crop.get("tight_path")):
        if not rel:
            continue
        rel_s = str(rel).replace("\\", "/")
        if ".." in rel_s.split("/"):
            continue
        fp = root / rel_s
        if fp.is_file():
            try:
                fp.unlink()
                removed_files.append(rel_s)
            except OSError:
                pass

    doc["figures"] = kept
    cat_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    unbound_pages: list[str] = []
    plan_path = root / "source" / "slide_plan.json"
    if plan_path.is_file():
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            plan = None
        if isinstance(plan, dict):
            changed = False
            for slide in plan.get("slides") or []:
                vp = slide.get("visual_plan")
                if not isinstance(vp, dict):
                    continue
                if vp.get("selected_figure_id") != figure_id:
                    continue
                vp["selected_figure_id"] = None
                vp["resolution_status"] = "needs_figure"
                unbound_pages.append(slide.get("page_id") or "")
                changed = True
            if changed:
                plan_path.write_text(
                    json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )

    return {
        "figure_id": figure_id,
        "removed_files": removed_files,
        "unbound_pages": [p for p in unbound_pages if p],
        "remaining": len(kept),
    }


_NO_FIG_ROLES = frozenset({"title", "agenda", "section", "summary", "references", "thanks"})


def _figure_delivery_rel(fig: dict[str, Any]) -> str | None:
    crop = fig.get("crop") or {}
    for rel in (fig.get("file_path"), crop.get("safe_path"), crop.get("tight_path")):
        if not rel:
            continue
        rel_s = str(rel).replace("\\", "/")
        if ".." in rel_s.split("/"):
            continue
        return rel_s
    return None


def _figure_has_file(root: Path, fig: dict[str, Any]) -> bool:
    rel = _figure_delivery_rel(fig)
    return bool(rel and (root / rel).is_file())


def _bind_slide_to_figure(slide: dict[str, Any], fig: dict[str, Any], *, now: str) -> None:
    vp = slide.setdefault("visual_plan", {})
    fid = fig.get("figure_id")
    vp["selected_figure_id"] = fid
    vp["resolution_status"] = "resolved"
    vp["blocked_reason"] = None
    if fig.get("figure_kind") in {"source_crop", "source_original"}:
        vp["visual_type"] = "paper_figure"
        vp["layout"] = vp.get("layout") or "figure_focus"
    cands = list(vp.get("candidate_figure_ids") or [])
    if fid and fid not in cands:
        cands.append(fid)
        vp["candidate_figure_ids"] = cands
    cap = (fig.get("caption_zh") or fig.get("original_caption") or "").strip()
    if cap:
        vp["caption"] = cap[:400]
    slide["status"] = "complete"
    slide.setdefault("freshness", {})["updated_at"] = now


def _paper_bind_score(slide: dict[str, Any], fig: dict[str, Any]) -> int:
    score = 1
    slide_kps = set(slide.get("knowledge_point_ids") or [])
    fig_kps = set(fig.get("mapped_knowledge_points") or [])
    if slide_kps and fig_kps:
        score += 20 * len(slide_kps & fig_kps)
    title = (slide.get("page_title") or "").lower()
    blob = " ".join(
        str(x or "")
        for x in (
            fig.get("original_caption"),
            fig.get("caption_zh"),
            fig.get("original_label"),
            " ".join(fig.get("mapped_knowledge_points") or []),
        )
    ).lower()
    for token in ("pathway", "structure", "assay", "mechanism", "漏斗", "靶点", "筛选"):
        if token in title and token in blob:
            score += 3
    return score


def reconcile_figures(project_id: str) -> dict[str, Any]:
    """Heal figure/page bindings and drop empty AI placeholders.

    Rules:
    1. Title / agenda / summary / references → no figure (not_needed).
    2. Content pages that need a figure should have selected_figure_id pointing at a real file.
    3. Paper crops with files must be bound (or stay only if every content page already has a figure).
    4. AI / adapted slots with no file and not selected are catalog noise → prune.
    """
    root = project_dir(project_id)
    cat_path = root / "source" / "figure_catalog.json"
    plan_path = root / "source" / "slide_plan.json"
    if not cat_path.is_file() or not plan_path.is_file():
        return {"ok": False, "reason": "missing_artifacts"}

    try:
        cat = json.loads(cat_path.read_text(encoding="utf-8"))
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"ok": False, "reason": "bad_json"}

    figures = list(cat.get("figures") or [])
    by_id = {f.get("figure_id"): f for f in figures if f.get("figure_id")}
    now = utc_now_iso()
    bound = 0
    pruned = 0
    cleaned_candidates = 0

    # --- prune empty unbound AI / adapted ---
    selected_ids: set[str] = set()
    for slide in plan.get("slides") or []:
        fid = (slide.get("visual_plan") or {}).get("selected_figure_id")
        if fid:
            selected_ids.add(str(fid))

    keep: list[dict[str, Any]] = []
    removed_ids: set[str] = set()
    for fig in figures:
        fid = str(fig.get("figure_id") or "")
        kind = fig.get("figure_kind") or ""
        has = _figure_has_file(root, fig)
        if kind in {"ai_scientific_illustration", "adapted_diagram"} and not has and fid not in selected_ids:
            removed_ids.add(fid)
            pruned += 1
            continue
        keep.append(fig)
    if removed_ids:
        figures = keep
        by_id = {f.get("figure_id"): f for f in figures if f.get("figure_id")}
        for slide in plan.get("slides") or []:
            vp = slide.get("visual_plan")
            if not isinstance(vp, dict):
                continue
            cands = [c for c in (vp.get("candidate_figure_ids") or []) if c not in removed_ids]
            if cands != (vp.get("candidate_figure_ids") or []):
                vp["candidate_figure_ids"] = cands
                cleaned_candidates += 1
            if vp.get("selected_figure_id") in removed_ids:
                vp["selected_figure_id"] = None
                if (vp.get("resolution_status") or "") == "resolved":
                    vp["resolution_status"] = "needs_figure"

    # --- normalize structural pages ---
    for slide in plan.get("slides") or []:
        role = slide.get("page_role") or "content"
        if role not in _NO_FIG_ROLES:
            continue
        vp = slide.setdefault("visual_plan", {})
        if vp.get("selected_figure_id") or vp.get("resolution_status") != "not_needed":
            vp["selected_figure_id"] = None
            vp["resolution_status"] = "not_needed"
            vp["layout"] = "text_only"
            vp["caption"] = None
            vp["alt_text"] = None
            vp["blocked_reason"] = None

    def _page_needs_figure(slide: dict[str, Any]) -> bool:
        role = slide.get("page_role") or "content"
        if role in _NO_FIG_ROLES:
            return False
        vp = slide.get("visual_plan") or {}
        if (vp.get("resolution_status") or "") == "not_needed" or vp.get("layout") == "text_only":
            return False
        return True

    def _valid_selection(slide: dict[str, Any]) -> bool:
        fid = (slide.get("visual_plan") or {}).get("selected_figure_id")
        if not fid:
            return False
        fig = by_id.get(fid)
        return bool(fig and _figure_has_file(root, fig))

    # Track which figures are already selected
    used: set[str] = set()
    for slide in plan.get("slides") or []:
        if _valid_selection(slide):
            used.add(str((slide.get("visual_plan") or {}).get("selected_figure_id")))

    # Heal pages: candidates with file first
    for slide in plan.get("slides") or []:
        if not _page_needs_figure(slide) or _valid_selection(slide):
            continue
        vp = slide.setdefault("visual_plan", {})
        if vp.get("selected_figure_id") and not _valid_selection(slide):
            vp["selected_figure_id"] = None
        for cand in vp.get("candidate_figure_ids") or []:
            fig = by_id.get(cand)
            if not fig or not _figure_has_file(root, fig):
                continue
            if str(cand) in used and fig.get("figure_kind") in {"source_crop", "source_original"}:
                continue
            _bind_slide_to_figure(slide, fig, now=now)
            used.add(str(cand))
            bound += 1
            break

    # Assign unbound paper crops to pages still needing figures
    paper_pool = [
        f
        for f in figures
        if f.get("figure_kind") in {"source_crop", "source_original"}
        and f.get("figure_id")
        and str(f["figure_id"]) not in used
        and _figure_has_file(root, f)
    ]
    needy = [s for s in (plan.get("slides") or []) if _page_needs_figure(s) and not _valid_selection(s)]
    for fig in paper_pool:
        if not needy:
            break
        best_i = 0
        best_score = -1
        for i, slide in enumerate(needy):
            sc = _paper_bind_score(slide, fig)
            if sc > best_score:
                best_score = sc
                best_i = i
        slide = needy.pop(best_i)
        _bind_slide_to_figure(slide, fig, now=now)
        used.add(str(fig["figure_id"]))
        bound += 1

    cat["figures"] = figures
    cat["updated_at"] = now
    plan["updated_at"] = now
    cat_path.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    unbound_files = sum(
        1
        for f in figures
        if f.get("figure_id")
        and str(f["figure_id"]) not in used
        and _figure_has_file(root, f)
    )
    return {
        "ok": True,
        "bound": bound,
        "pruned_empty_ai": pruned,
        "cleaned_candidate_lists": cleaned_candidates,
        "unbound_with_file": unbound_files,
        "figures_remaining": len(figures),
    }


def translate_and_store_caption(project_id: str, figure_id: str) -> dict[str, Any]:
    """Translate original_caption → caption_zh via Bailian; persist to figure_catalog."""
    _ensure_deck_on_path()
    from visuals.caption_translate import ensure_caption_zh  # noqa: WPS433

    root = project_dir(project_id)
    path = root / "source" / "figure_catalog.json"
    if not path.is_file():
        raise FileNotFoundError("figure_catalog.json")
    doc = json.loads(path.read_text(encoding="utf-8"))
    target = None
    for fig in doc.get("figures") or []:
        if fig.get("figure_id") == figure_id:
            target = fig
            break
    if target is None:
        raise KeyError(figure_id)

    existing = (target.get("caption_zh") or "").strip()
    if existing:
        return {
            "figure_id": figure_id,
            "caption_zh": existing,
            "caption": existing,
            "translated": False,
        }

    en = (target.get("original_caption") or "").strip()
    if not en:
        raise ValueError("no English caption to translate")

    zh = ensure_caption_zh(target, allow_translate=True)
    if not zh:
        raise RuntimeError("translation failed (bailian text chat unavailable?)")

    # Prefer 图 N in stored zh if model kept Fig.
    zh = re.sub(r"^(Fig(?:ure)?\.?)\s*", "图 ", zh, count=1, flags=re.I)
    target["caption_zh"] = zh
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "figure_id": figure_id,
        "caption_zh": zh,
        "caption": zh,
        "translated": True,
        "figure_id_zh": zh_figure_id(figure_id),
        "original_label_zh": zh_paper_figure_label(target.get("original_label")),
    }


def create_project(
    *,
    project_id: str,
    prompt: str,
    audience: str,
    target_minutes: int = 50,
    dissemination: str = "internal_class",
    subject: str = "biology",
    course_title: str | None = None,
    theme_id: str = "green",
) -> Path:
    if not SLUG_RE.match(project_id):
        raise ValueError("project_id must be alphanumeric / _-")
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("prompt (需求描述) is required")
    title = (course_title or "").strip() or _short_title(prompt)
    root = workspace_root() / project_id
    if root.exists():
        raise FileExistsError(project_id)
    for sub in ("source", "deck", "generated", "images", "papers", "extracted", "sources/pdf", "materials"):
        (root / sub).mkdir(parents=True, exist_ok=True)

    now = utc_now_iso()
    _ensure_deck_on_path()
    from deck.themes import write_project_theme

    write_project_theme(root, theme_id)
    brief = f"""# 项目简报：{title}

## 用户需求（原文）

{prompt}

## 主题

{title}

## 受众

{audience}

## 课时与页数

- **{target_minutes} 分钟**
- 目标 **{"25–40" if target_minutes >= 45 else "10–14"} 页**

## 传播范围

{dissemination}

## 教学目标

（根据上方需求整理后，在 Gate 0 确认）

## Keywords

（待补充）
"""
    (root / "source" / "project_brief.md").write_text(brief, encoding="utf-8")
    outline = {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "updated_at": now,
        "status": "draft",
        "subject": subject,
        "course_title": title,
        "audience": audience,
        "target_minutes": int(target_minutes),
        "target_page_range": [25, 40] if target_minutes >= 45 else [10, 14],
        "sections": [
            {
                "section_id": "SEC01",
                "title": "导论",
                "order": 1,
                "estimated_minutes": float(target_minutes),
                "knowledge_points": [
                    {
                        "kp_id": "KP01",
                        "title": "本节核心问题",
                        "description": title,
                        "learning_objective": "能口述本节要解决的核心问题",
                        "order": 1,
                        "must_cover": True,
                        "teaching_beats": [
                            {
                                "beat_id": "KP01-B01",
                                "title": "总览",
                                "intent": "overview",
                                "order": 1,
                                "needs_figure": True,
                                "figure_hint": "一页总览示意图",
                                "on_slide_points": [
                                    "问题 — 本节要讲什么",
                                    "结构 — 怎么展开",
                                    "带走 — 一句话心智模型",
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }
    (root / "source" / "outline.json").write_text(
        json.dumps(outline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    decisions = {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "updated_at": now,
        "decisions": [
            {
                "decision_id": "D001",
                "gate": "gate0_brief",
                "actor": {"kind": "system", "name": "studio"},
                "action": "confirm",
                "ai_recommendation": None,
                "user_choice": "入口需求即简报（界面已隐藏简报步）",
                "reason": "用户创建时粘贴的需求写入 project_brief.md，供大纲生成使用；不再单独确认 Gate 0。",
                "before": None,
                "after": {"brief_source": "create_prompt"},
                "affected_entities": [],
                "invalidation_scope": [],
                "created_at": now,
            }
        ],
    }
    (root / "source" / "decisions.json").write_text(
        json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    meta = {
        "dissemination": dissemination,
        "created_at": now,
        "engine": "sci-teaching-deck",
    }
    (root / "studio_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return root


def load_json(project_id: str, rel: str) -> Any:
    path = project_dir(project_id) / rel
    if not path.is_file():
        raise FileNotFoundError(rel)
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(project_id: str, rel: str, data: Any) -> None:
    path = project_dir(project_id) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, dict):
        data = {**data, "updated_at": utc_now_iso()}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_decision(project_id: str, decision: dict[str, Any]) -> None:
    path = project_dir(project_id) / "source" / "decisions.json"
    if path.is_file():
        doc = json.loads(path.read_text(encoding="utf-8"))
    else:
        doc = {
            "schema_version": "1.0.0",
            "project_id": project_id,
            "updated_at": utc_now_iso(),
            "decisions": [],
        }
    n = len(doc.get("decisions") or []) + 1
    decision.setdefault("decision_id", f"D{n:03d}")
    decision.setdefault("decided_at", utc_now_iso())
    doc.setdefault("decisions", []).append(decision)
    doc["updated_at"] = utc_now_iso()
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def register_uat_link(project_id: str) -> Path:
    """Symlink (or copy on Windows failure) a deck uat project into workspace."""
    src = deck_root() / "uat" / project_id
    if not src.is_dir():
        raise FileNotFoundError(f"uat/{project_id}")
    dst = workspace_root() / project_id
    if dst.exists():
        return dst
    try:
        dst.symlink_to(src, target_is_directory=True)
    except OSError:
        shutil.copytree(src, dst)
    return dst


_SNAPSHOT_KEEP = 5
_DESTRUCTIVE_VISUAL_STEPS = frozenset(
    {
        "extract",
        "plan_figures",
        "confirm_figures",
        "crop",
        "draft",
        "fill",
        "fill_skip_resolved",
        "run_default_pipeline",
    }
)
_OUTLINE_SNAPSHOT_STEPS = frozenset({"generate_outline"})


def _snapshots_root(project_id: str) -> Path:
    return project_dir(project_id) / "source" / "_snapshots"


def _outline_snapshots_root(project_id: str) -> Path:
    return project_dir(project_id) / "source" / "_outline_snapshots"


def _copy_if_exists(src: Path, dst: Path) -> bool:
    if not src.is_file():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


def snapshot_visual_state(project_id: str, *, reason: str = "") -> dict[str, Any] | None:
    """Snapshot figure_catalog + slide_plan + delivery image files before destructive jobs."""
    root = project_dir(project_id)
    fig_path = root / "source" / "figure_catalog.json"
    plan_path = root / "source" / "slide_plan.json"
    if not fig_path.is_file() and not plan_path.is_file():
        return None

    stamp = utc_now_iso().replace(":", "").replace("-", "")
    snap = _snapshots_root(project_id) / stamp
    files_dir = snap / "files"
    snap.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    if fig_path.is_file():
        shutil.copy2(fig_path, snap / "figure_catalog.json")
        try:
            doc = json.loads(fig_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            doc = {}
        for fig in doc.get("figures") or []:
            crop = fig.get("crop") or {}
            for rel in (fig.get("file_path"), crop.get("safe_path"), crop.get("tight_path")):
                if not rel:
                    continue
                rel_s = str(rel).replace("\\", "/")
                if _copy_if_exists(root / rel_s, files_dir / rel_s):
                    copied.append(rel_s)
            # common AI delivery naming
            fid = fig.get("figure_id")
            if fid:
                for rel_s in (f"generated/{fid}_safe.png", f"generated/{fid}.png"):
                    if _copy_if_exists(root / rel_s, files_dir / rel_s):
                        copied.append(rel_s)

    if plan_path.is_file():
        shutil.copy2(plan_path, snap / "slide_plan.json")

    # also keep draft pptx if present (lightweight enough for undo UX)
    for pptx in ("deck/draft-with-images.pptx", "deck/draft.pptx", "deck/draft-no-images.pptx"):
        if _copy_if_exists(root / pptx, files_dir / pptx):
            copied.append(pptx)

    meta = {
        "id": stamp,
        "created_at": utc_now_iso(),
        "reason": reason,
        "files": sorted(set(copied)),
        "has_figure_catalog": (snap / "figure_catalog.json").is_file(),
        "has_slide_plan": (snap / "slide_plan.json").is_file(),
    }
    (snap / "manifest.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # prune old
    snaps = sorted(
        [p for p in _snapshots_root(project_id).iterdir() if p.is_dir()],
        key=lambda p: p.name,
        reverse=True,
    )
    for old in snaps[_SNAPSHOT_KEEP:]:
        shutil.rmtree(old, ignore_errors=True)
    return meta


def list_visual_snapshots(project_id: str) -> list[dict[str, Any]]:
    root = _snapshots_root(project_id)
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted([x for x in root.iterdir() if x.is_dir()], key=lambda x: x.name, reverse=True):
        man = p / "manifest.json"
        if man.is_file():
            try:
                out.append(json.loads(man.read_text(encoding="utf-8")))
                continue
            except json.JSONDecodeError:
                pass
        out.append({"id": p.name, "created_at": None, "reason": "", "files": []})
    return out


def restore_visual_snapshot(project_id: str, snapshot_id: str | None = None) -> dict[str, Any]:
    """Restore latest (or named) visual snapshot. Takes a pre-restore snapshot first."""
    snaps = list_visual_snapshots(project_id)
    if not snaps:
        raise FileNotFoundError("no visual snapshots")
    target_id = snapshot_id or snaps[0]["id"]
    snap = _snapshots_root(project_id) / target_id
    if not snap.is_dir():
        raise FileNotFoundError(target_id)

    # safety: snapshot current before overwrite
    snapshot_visual_state(project_id, reason=f"pre-restore-of-{target_id}")

    root = project_dir(project_id)
    restored: list[str] = []
    for name in ("figure_catalog.json", "slide_plan.json"):
        src = snap / name
        if src.is_file():
            dst = root / "source" / name
            shutil.copy2(src, dst)
            restored.append(f"source/{name}")

    files_dir = snap / "files"
    if files_dir.is_dir():
        for path in files_dir.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(files_dir).as_posix()
            dst = root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dst)
            restored.append(rel)

    return {"restored_from": target_id, "items": restored, "count": len(restored)}


def should_snapshot_before_step(step: str) -> bool:
    return step in _DESTRUCTIVE_VISUAL_STEPS


def snapshot_outline_state(project_id: str, *, reason: str = "") -> dict[str, Any] | None:
    """Snapshot source/outline.json before overwrite / regenerate."""
    root = project_dir(project_id)
    outline_path = root / "source" / "outline.json"
    if not outline_path.is_file():
        return None

    stamp = utc_now_iso().replace(":", "").replace("-", "")
    snap = _outline_snapshots_root(project_id) / stamp
    snap.mkdir(parents=True, exist_ok=True)
    shutil.copy2(outline_path, snap / "outline.json")
    meta = {
        "id": stamp,
        "created_at": utc_now_iso(),
        "reason": reason,
        "has_outline": True,
    }
    (snap / "manifest.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    snaps = sorted(
        [p for p in _outline_snapshots_root(project_id).iterdir() if p.is_dir()],
        key=lambda p: p.name,
        reverse=True,
    )
    for old in snaps[_SNAPSHOT_KEEP:]:
        shutil.rmtree(old, ignore_errors=True)
    return meta


def list_outline_snapshots(project_id: str) -> list[dict[str, Any]]:
    root = _outline_snapshots_root(project_id)
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted([x for x in root.iterdir() if x.is_dir()], key=lambda x: x.name, reverse=True):
        man = p / "manifest.json"
        if man.is_file():
            try:
                out.append(json.loads(man.read_text(encoding="utf-8")))
                continue
            except json.JSONDecodeError:
                pass
        out.append({"id": p.name, "created_at": None, "reason": ""})
    return out


def restore_outline_snapshot(project_id: str, snapshot_id: str | None = None) -> dict[str, Any]:
    """Restore latest (or named) outline snapshot. Snapshots current first."""
    snaps = list_outline_snapshots(project_id)
    if not snaps:
        raise FileNotFoundError("no outline snapshots")
    target_id = snapshot_id or snaps[0]["id"]
    snap = _outline_snapshots_root(project_id) / target_id
    src = snap / "outline.json"
    if not src.is_file():
        raise FileNotFoundError(target_id)

    snapshot_outline_state(project_id, reason=f"pre-restore-of-{target_id}")
    dst = project_dir(project_id) / "source" / "outline.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return {"restored_from": target_id, "items": ["source/outline.json"], "count": 1}


def should_snapshot_outline_before_step(step: str) -> bool:
    return step in _OUTLINE_SNAPSHOT_STEPS


_SAFE_MATERIAL_NAME = re.compile(r"^[\w.\- \u4e00-\u9fff()（）【】\[\]]{1,180}$")
_TEXT_SUFFIXES = {".md", ".txt", ".markdown", ".csv"}
_ALLOWED_SUFFIXES = {
    ".pdf",
    ".md",
    ".txt",
    ".markdown",
    ".csv",
    ".docx",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
}


def materials_dir(project_id: str) -> Path:
    d = project_dir(project_id) / "materials"
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_materials(project_id: str) -> list[dict[str, Any]]:
    root = materials_dir(project_id)
    rows: list[dict[str, Any]] = []
    for p in sorted(root.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_file():
            continue
        rows.append(
            {
                "name": p.name,
                "path": f"materials/{p.name}",
                "size": p.stat().st_size,
                "suffix": p.suffix.lower(),
            }
        )
    return rows


def save_material(project_id: str, filename: str, data: bytes) -> dict[str, Any]:
    name = Path(filename or "upload.bin").name.strip()
    if not name or not _SAFE_MATERIAL_NAME.match(name):
        raise ValueError("invalid filename")
    suffix = Path(name).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise ValueError(f"unsupported type: {suffix or '(none)'}")
    if len(data) > 40 * 1024 * 1024:
        raise ValueError("file too large (max 40MB)")

    dest = materials_dir(project_id) / name
    # avoid overwrite clobber: add suffix if exists
    if dest.exists():
        stem, ext = dest.stem, dest.suffix
        n = 2
        while True:
            cand = dest.with_name(f"{stem}-{n}{ext}")
            if not cand.exists():
                dest = cand
                name = cand.name
                break
            n += 1
    dest.write_bytes(data)

    brief_note = ""
    if suffix in _TEXT_SUFFIXES:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("utf-8", errors="replace")
        excerpt = text.strip()[:8000]
        if excerpt:
            brief_note = f"\n\n## 上传资料：{name}\n\n{excerpt}\n"
    else:
        brief_note = f"\n\n## 上传资料\n\n- `{name}`（已存入 materials/，供后续检索/配图参考）\n"

    if brief_note:
        brief_path = project_dir(project_id) / "source" / "project_brief.md"
        if brief_path.is_file():
            brief_path.write_text(brief_path.read_text(encoding="utf-8") + brief_note, encoding="utf-8")

    return {"name": name, "path": f"materials/{name}", "size": len(data), "suffix": suffix}


def _next_source_id(sources: list[dict[str, Any]]) -> str:
    max_n = 0
    for s in sources:
        sid = str(s.get("source_id") or "")
        m = re.match(r"^S(\d+)$", sid, re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"S{max_n + 1:03d}"


def _default_kp_ids(project_id: str) -> list[str]:
    try:
        outline = load_json(project_id, "source/outline.json")
    except FileNotFoundError:
        return []
    for sec in outline.get("sections") or []:
        for kp in sec.get("knowledge_points") or []:
            kid = kp.get("kp_id")
            if kid:
                return [str(kid)]
    return []


def _empty_sources_doc(project_id: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "updated_at": utc_now_iso(),
        "sources": [],
    }


def load_or_init_sources(project_id: str) -> dict[str, Any]:
    try:
        return load_json(project_id, "source/sources.json")
    except FileNotFoundError:
        doc = _empty_sources_doc(project_id)
        save_json(project_id, "source/sources.json", doc)
        return doc


def _base_user_source(
    *,
    source_id: str,
    title: str,
    year: int | None,
    authors: list[str],
    doi: str | None,
    url: str | None,
    kp_ids: list[str],
    notes: str | None,
    fulltext_status: str,
    fulltext_path: str | None,
    source_type: str = "journal_article",
) -> dict[str, Any]:
    now = utc_now_iso()
    doi_clean = (doi or "").strip() or None
    return {
        "source_id": source_id,
        "source_type": source_type,
        "title": title.strip(),
        "authors": authors,
        "year": year,
        "venue_or_publisher": None,
        "identifiers": {
            "doi": doi_clean,
            "pmid": None,
            "pmcid": None,
            "isbn": None,
            "arxiv_id": None,
            "nbk_id": None,
            "url": url or (f"https://doi.org/{doi_clean}" if doi_clean else None),
        },
        "quality_signals": {
            "impact_factor": None,
            "jcr_quartile": None,
            "metric_year": None,
            "citation_count": None,
            "normalized_citation": None,
            "landmark": False,
            "retraction_status": "unknown",
            "metric_sources": [],
        },
        "retrieval_sources": ["user"],
        "retrieved_at": now,
        "fulltext_status": fulltext_status,
        "fulltext_path": fulltext_path,
        "processing_state": "user_added",
        "screening_decision": "keep",
        "screening_reason": "用户指定/上传",
        "user_confirmation": "selected",
        "user_confirmation_reason": "用户手动添加",
        "mapped_knowledge_points": kp_ids,
        "license_status": "unknown",
        "content_hash": None,
        "notes": notes,
        "freshness": {"updated_at": now, "stale": False, "stale_reason": None},
    }


def add_manual_source(
    project_id: str,
    *,
    title: str,
    year: int | None = None,
    authors: str | None = None,
    doi: str | None = None,
) -> dict[str, Any]:
    title = (title or "").strip()
    if not title:
        raise ValueError("请填写文献标题")
    if len(title) > 500:
        raise ValueError("标题过长")

    doc = load_or_init_sources(project_id)
    sources = list(doc.get("sources") or [])
    # dedupe by exact title (casefold)
    key = title.casefold()
    for s in sources:
        if str(s.get("title") or "").casefold() == key:
            raise ValueError(f"已存在同名文献：{s.get('source_id')}")

    author_list = [a.strip() for a in re.split(r"[,;，；]", authors or "") if a.strip()]
    sid = _next_source_id(sources)
    entry = _base_user_source(
        source_id=sid,
        title=title,
        year=year,
        authors=author_list,
        doi=doi,
        url=None,
        kp_ids=_default_kp_ids(project_id),
        notes="manual_title",
        fulltext_status="unavailable",
        fulltext_path=None,
    )
    sources.append(entry)
    doc["sources"] = sources
    doc["updated_at"] = utc_now_iso()
    save_json(project_id, "source/sources.json", doc)
    append_decision(
        project_id,
        {
            "gate": "gate2_sources",
            "actor": {"kind": "user", "name": "studio"},
            "action": "add_manual_source",
            "user_choice": title,
            "reason": "用户指定文献名",
            "before": {},
            "after": {"source_id": sid},
            "affected_entities": [sid],
            "invalidation_scope": [],
        },
    )
    return entry


def add_uploaded_pdf_source(project_id: str, filename: str, data: bytes) -> dict[str, Any]:
    name = Path(filename or "paper.pdf").name.strip()
    if not name:
        raise ValueError("invalid filename")
    suffix = Path(name).suffix.lower()
    if suffix != ".pdf":
        raise ValueError("仅支持上传 PDF 文献")
    if len(data) > 40 * 1024 * 1024:
        raise ValueError("file too large (max 40MB)")

    doc = load_or_init_sources(project_id)
    sources = list(doc.get("sources") or [])
    sid = _next_source_id(sources)

    pdf_dir = project_dir(project_id) / "sources" / "pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    dest = pdf_dir / f"{sid}.pdf"
    dest.write_bytes(data)

    title = Path(name).stem.strip() or sid
    # soft dedupe: if same stem title exists as user upload, still allow (different file)
    entry = _base_user_source(
        source_id=sid,
        title=title,
        year=None,
        authors=[],
        doi=None,
        url=None,
        kp_ids=_default_kp_ids(project_id),
        notes=f"uploaded:{name}",
        fulltext_status="available",
        fulltext_path=f"sources/pdf/{sid}.pdf",
        source_type="user_pdf",
    )
    sources.append(entry)
    doc["sources"] = sources
    doc["updated_at"] = utc_now_iso()
    save_json(project_id, "source/sources.json", doc)
    append_decision(
        project_id,
        {
            "gate": "gate2_sources",
            "actor": {"kind": "user", "name": "studio"},
            "action": "upload_source_pdf",
            "user_choice": name,
            "reason": "用户上传 PDF",
            "before": {},
            "after": {"source_id": sid, "fulltext_path": entry["fulltext_path"]},
            "affected_entities": [sid],
            "invalidation_scope": [],
        },
    )
    return entry
