"""sci-teaching-studio thin API — wraps sci-teaching-deck scripts + gates.

    uvicorn teaching_api:app --app-dir backend --port 2025 --reload
"""

from __future__ import annotations

import io
import mimetypes
import zipfile
from pathlib import Path

from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

import jobs as J
import projects as P
import providers as PV

app = FastAPI(title="sci-teaching-studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load persisted BYO keys into process env (for in-process copilot)
try:
    import os as _os

    for _k, _v in PV.job_env_overrides().items():
        _os.environ[_k] = _v
except Exception:
    pass


class CreateProjectBody(BaseModel):
    project_id: str = Field(..., pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
    prompt: str = Field(..., min_length=1, description="用户需求：题目或一段说明文字")
    audience: str = "研究生一年级"
    target_minutes: int = 50
    dissemination: str = "internal_class"
    subject: str = "biology"
    course_title: str | None = None  # optional short deck title; else derived from prompt
    theme_id: str = "green"


class GateConfirmBody(BaseModel):
    user_choice: str = "确认"
    reason: str | None = None
    outline_status: str | None = None  # for gate1 → user_confirmed


class JobBody(BaseModel):
    step: str
    only: list[str] | None = None
    skip_crop: bool = False
    from_step: str | None = Field(None, alias="from")
    pptx: str | None = None
    limit: int | None = None

    class Config:
        populate_by_name = True


class CopilotOutlineBody(BaseModel):
    message: str = Field(..., min_length=1)


class CopilotFigureBody(BaseModel):
    page_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)


class CopilotFigureClearBody(BaseModel):
    page_id: str | None = None
    all_pages: bool = False


class CopilotStudioBody(BaseModel):
    screen: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    page_id: str | None = None


@app.get("/health")
def health():
    return {
        "ok": True,
        "deck_root": str(P.deck_root()),
        "workspace": str(P.workspace_root()),
        "python": str(P.python_exe()),
        "steps": J.known_steps(),
        "providers": PV.public_state().get("capabilities"),
    }


class ProvidersBody(BaseModel):
    text: dict | None = None
    image: dict | None = None
    literature: dict | None = None


class ProvidersTestBody(BaseModel):
    kind: str = Field(..., min_length=1)
    provider: str = ""
    api_key: str = ""
    base_url: str = ""
    model: str = ""


@app.get("/providers")
def providers_state():
    return PV.public_state()


@app.post("/providers")
def providers_save(body: ProvidersBody):
    try:
        state = PV.save(body.model_dump())
        import os as _os

        for k, v in PV.job_env_overrides().items():
            _os.environ[k] = v
        return state
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/providers/test")
def providers_test(body: ProvidersTestBody):
    return PV.test_connection(
        body.kind,
        api_key=body.api_key,
        base_url=body.base_url,
        model=body.model,
        provider=body.provider,
    )


@app.get("/themes")
def list_builtin_themes():
    P._ensure_deck_on_path()
    from deck.themes import DEFAULT_DESIGNS, DEFAULT_THEME_ID, list_designs_by_kind, list_themes

    return {
        "default": DEFAULT_THEME_ID,
        "default_designs": DEFAULT_DESIGNS,
        "themes": list_themes(),
        "designs": list_designs_by_kind(),
        # back-compat
        "layouts": list_designs_by_kind().get("content") or [],
        "default_layout": DEFAULT_DESIGNS.get("content", "rule"),
    }


@app.get("/projects/{project_id}/theme")
def get_project_theme(project_id: str):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    P._ensure_deck_on_path()
    from deck.themes import list_designs_by_kind, list_themes, load_project_theme_state

    state = load_project_theme_state(root)
    theme = state.resolved_theme()
    accent = state.resolved_accent()
    return {
        "theme_id": state.theme_id,
        "accent": accent,
        "custom_accents": state.custom_accents,
        "designs": state.designs,
        "optional_pages": state.optional_pages,
        "layout_id": state.designs.get("content", "rule"),
        "theme": {
            "id": state.theme_id,
            "name": theme.name if state.theme_id != "custom" else "自定义",
            "board": theme.board,
            "accent": accent,
            "ink": theme.ink,
            "muted": theme.muted,
            "rule": theme.rule,
            "sample_title": theme.sample_title,
            "style_prompt": theme.style_prompt,
        },
        "themes": list_themes(),
        "designs_catalog": list_designs_by_kind(),
        "layouts": list_designs_by_kind().get("content") or [],
    }


class ThemeBody(BaseModel):
    theme_id: str | None = None
    layout_id: str | None = None
    accent: str | None = None
    custom_accents: list[str] | None = None
    designs: dict[str, str] | None = None
    optional_pages: dict[str, bool] | None = None


@app.put("/projects/{project_id}/theme")
def put_project_theme(project_id: str, body: ThemeBody):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    P._ensure_deck_on_path()
    from deck.optional_pages import sync_optional_pages
    from deck.themes import BUILTIN_THEMES, write_project_theme

    if body.theme_id and body.theme_id not in {t.id for t in BUILTIN_THEMES} and body.theme_id != "custom":
        raise HTTPException(400, f"未知主题：{body.theme_id}") from None
    if not any(
        [
            body.theme_id,
            body.layout_id,
            body.accent,
            body.custom_accents is not None,
            body.designs,
            body.optional_pages is not None,
        ]
    ):
        raise HTTPException(400, "请提供 theme_id / designs / accent / optional_pages") from None

    payload = write_project_theme(
        root,
        body.theme_id,
        layout_id=body.layout_id,
        accent=body.accent,
        custom_accents=body.custom_accents,
        designs=body.designs,
        optional_pages=body.optional_pages,
    )
    sync_note = None
    try:
        sync_note = sync_optional_pages(root)
    except Exception as exc:  # noqa: BLE001
        sync_note = {"ok": False, "reason": str(exc)}

    P.append_decision(
        project_id,
        {
            "gate": "theme",
            "actor": {"kind": "user", "name": "studio"},
            "action": "set_theme",
            "user_choice": payload.get("theme_id"),
            "reason": "选择白板页种设计 / 强调色 / 可选页",
            "after": {
                "theme_id": payload.get("theme_id"),
                "designs": payload.get("designs"),
                "accent": payload.get("accent"),
                "optional_pages": payload.get("optional_pages"),
            },
            "affected_entities": ["source/theme.json", "source/slide_plan.json"],
            "invalidation_scope": ["deck/*.pptx"],
        },
    )
    return {"ok": True, "theme": payload, "optional_sync": sync_note}


@app.get("/projects")
def list_projects():
    return {"projects": P.list_projects()}


@app.post("/projects")
def create_project(body: CreateProjectBody):
    try:
        path = P.create_project(
            project_id=body.project_id,
            prompt=body.prompt,
            audience=body.audience,
            target_minutes=body.target_minutes,
            dissemination=body.dissemination,
            subject=body.subject,
            course_title=body.course_title,
            theme_id=body.theme_id,
        )
    except FileExistsError:
        raise HTTPException(409, "project exists") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {"id": body.project_id, "path": str(path)}


@app.post("/projects/{project_id}/register-uat")
def register_uat(project_id: str):
    try:
        path = P.register_uat_link(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "uat project not found under sci-teaching-deck/uat") from None
    return {"id": project_id, "path": str(path)}


@app.get("/projects/{project_id}/materials")
def get_materials(project_id: str):
    try:
        return {"materials": P.list_materials(project_id)}
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/projects/{project_id}/materials")
async def upload_materials(project_id: str, files: list[UploadFile] = File(...)):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    if not files:
        raise HTTPException(400, "no files")
    saved = []
    errors = []
    for f in files:
        try:
            data = await f.read()
            meta = P.save_material(project_id, f.filename or "upload.bin", data)
            saved.append(meta)
        except ValueError as exc:
            errors.append({"name": f.filename, "error": str(exc)})
    return {"ok": True, "saved": saved, "errors": errors}

@app.get("/projects/{project_id}")
def get_project(project_id: str):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    summary = {
        "id": project_id,
        "path": str(root),
        "artifacts": {},
    }
    for rel in (
        "source/project_brief.md",
        "source/outline.json",
        "source/theme.json",
        "source/sources.json",
        "source/claims.json",
        "source/figure_catalog.json",
        "source/slide_plan.json",
        "source/decisions.json",
        "qa_report.json",
        "deck/final.pptx",
        "deck/draft-with-images.pptx",
        "bibliography.md",
        "image_attributions.md",
        "lecture_script.md",
    ):
        summary["artifacts"][rel] = (root / rel).is_file()
    try:
        outline = P.load_json(project_id, "source/outline.json")
        summary["course_title"] = outline.get("course_title")
        summary["status"] = outline.get("status")
        summary["audience"] = outline.get("audience")
    except FileNotFoundError:
        pass
    try:
        P._ensure_deck_on_path()
        from deck.themes import load_project_theme_state

        state = load_project_theme_state(root)
        theme = state.resolved_theme()
        layout = state.resolved_layout()
        accent = state.resolved_accent()
        summary["theme_id"] = state.theme_id
        summary["layout_id"] = layout.id
        summary["custom_accents"] = state.custom_accents
        summary["theme"] = {
            "id": state.theme_id,
            "name": theme.name if state.theme_id != "custom" else "自定义",
            "board": theme.board,
            "accent": accent,
            "layout_id": layout.id,
        }
    except Exception:
        summary["theme_id"] = "green"
        summary["layout_id"] = "rule"
    return summary


@app.get("/projects/{project_id}/artifact")
def read_artifact(project_id: str, path: str):
    """Read a source JSON/md under the project (path relative, must stay in project)."""
    try:
        root = P.project_dir(project_id).resolve()
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    rel = path.replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        raise HTTPException(400, "invalid path")
    target = (root / rel).resolve()
    if not str(target).startswith(str(root)):
        raise HTTPException(400, "path escape")
    if not target.is_file():
        raise HTTPException(404, "artifact missing")
    if target.suffix.lower() in {".json"}:
        return P.load_json(project_id, rel)
    if target.suffix.lower() in {".md", ".txt"}:
        return JSONResponse({"path": rel, "text": target.read_text(encoding="utf-8")})
    # binary: inline for <img>, not attachment download
    media = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(
        target,
        media_type=media,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f'inline; filename="{target.name}"',
        },
    )


@app.get("/projects/{project_id}/download-pack")
def download_pack(project_id: str):
    """Zip PPT + lecture_script.md for one-click download."""
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None

    pptx = None
    for rel in ("deck/final.pptx", "deck/draft-with-images.pptx", "deck/draft.pptx"):
        candidate = root / rel
        if candidate.is_file():
            pptx = candidate
            break
    script = root / "lecture_script.md"
    if pptx is None:
        raise HTTPException(404, "暂无 PPT 可打包")
    if not script.is_file():
        raise HTTPException(404, "暂无讲稿可打包")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(pptx, arcname=pptx.name)
        zf.write(script, arcname="lecture_script.md")
    data = buf.getvalue()
    filename = f"{project_id}-课件包.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


class SourceDecisionBody(BaseModel):
    source_id: str
    user_confirmation: str = Field(..., pattern=r"^(selected|rejected|proposed)$")
    reason: str | None = None


class ManualSourceBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    year: int | None = None
    authors: str | None = None
    doi: str | None = None


class BriefBody(BaseModel):
    text: str


@app.put("/projects/{project_id}/brief")
def put_brief(project_id: str, body: BriefBody):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    path = root / "source" / "project_brief.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.text, encoding="utf-8")
    return {"ok": True}


@app.get("/projects/{project_id}/lecture-script")
def get_lecture_script(project_id: str):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    path = root / "lecture_script.md"
    if not path.is_file():
        raise HTTPException(404, "lecture_script.md missing")
    return {"text": path.read_text(encoding="utf-8"), "path": "lecture_script.md"}


@app.put("/projects/{project_id}/lecture-script")
def put_lecture_script(project_id: str, body: BriefBody):
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    path = root / "lecture_script.md"
    path.write_text(body.text, encoding="utf-8")
    P._ensure_deck_on_path()
    sync_notes: list[str] = []
    try:
        from lecture.pipeline import sync_lecture_script_to_speaker_notes

        sync_notes = sync_lecture_script_to_speaker_notes(root, script_path=path)
    except Exception:  # noqa: BLE001
        sync_notes = []
    return {"ok": True, "notes_sync": sync_notes}


class LectureRegenBody(BaseModel):
    page_id: str = Field(..., min_length=1)
    pptx: str | None = None


@app.post("/projects/{project_id}/lecture-script/regenerate")
def regenerate_lecture_page(project_id: str, body: LectureRegenBody):
    """Re-generate oral script for a single page and patch lecture_script.md."""
    try:
        root = P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None

    pptx = (body.pptx or "").strip() or "final.pptx"
    if not (root / "deck" / pptx).is_file():
        for alt in ("final.pptx", "draft-with-images.pptx", "draft.pptx"):
            if (root / "deck" / alt).is_file():
                pptx = alt
                break

    P._ensure_deck_on_path()
    try:
        from lecture.pipeline import regenerate_page_lecture
    except ImportError as exc:
        raise HTTPException(500, f"lecture pipeline unavailable: {exc}") from exc

    result = regenerate_page_lecture(root, body.page_id, pptx_name=pptx)
    if not result.path or not result.script:
        detail = "; ".join(result.notes) if result.notes else "regenerate failed"
        raise HTTPException(502, detail)
    return {
        "ok": True,
        "page_id": result.page_id,
        "script": result.script,
        "notes": result.notes,
        "path": "lecture_script.md",
    }


@app.get("/projects/{project_id}/sources")
def get_sources(project_id: str):
    try:
        doc = P.load_json(project_id, "source/sources.json")
    except FileNotFoundError:
        raise HTTPException(404, "sources.json missing") from None
    rows = []
    for s in doc.get("sources") or []:
        ids = s.get("identifiers") or {}
        retrieval = s.get("retrieval_sources") or []
        rows.append(
            {
                "source_id": s.get("source_id"),
                "title": s.get("title"),
                "year": s.get("year"),
                "source_type": s.get("source_type"),
                "screening_decision": s.get("screening_decision"),
                "screening_reason": s.get("screening_reason"),
                "user_confirmation": s.get("user_confirmation"),
                "mapped_knowledge_points": s.get("mapped_knowledge_points") or [],
                "doi": ids.get("doi"),
                "pmid": ids.get("pmid"),
                "fulltext_status": s.get("fulltext_status"),
                "fulltext_path": s.get("fulltext_path"),
                "from_user": "user" in retrieval or s.get("source_type") == "user_pdf",
            }
        )
    counts = {
        "total": len(rows),
        "proposed": sum(1 for r in rows if r["user_confirmation"] == "proposed"),
        "selected": sum(1 for r in rows if r["user_confirmation"] == "selected"),
        "rejected": sum(1 for r in rows if r["user_confirmation"] == "rejected"),
        "keep": sum(1 for r in rows if r["screening_decision"] == "keep"),
        "maybe": sum(1 for r in rows if r["screening_decision"] == "maybe"),
        "drop": sum(1 for r in rows if r["screening_decision"] == "drop"),
    }
    return {"project_id": project_id, "sources": rows, "counts": counts}


@app.post("/projects/{project_id}/sources/manual")
def add_manual_source(project_id: str, body: ManualSourceBody):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        entry = P.add_manual_source(
            project_id,
            title=body.title,
            year=body.year,
            authors=body.authors,
            doi=body.doi,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {"ok": True, "source": entry}


@app.post("/projects/{project_id}/sources/upload")
async def upload_source_pdfs(project_id: str, files: list[UploadFile] = File(...)):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    if not files:
        raise HTTPException(400, "no files")
    saved = []
    errors = []
    for f in files:
        try:
            data = await f.read()
            entry = P.add_uploaded_pdf_source(project_id, f.filename or "paper.pdf", data)
            saved.append(
                {
                    "source_id": entry.get("source_id"),
                    "title": entry.get("title"),
                    "fulltext_path": entry.get("fulltext_path"),
                }
            )
        except ValueError as exc:
            errors.append({"name": f.filename, "error": str(exc)})
    return {"ok": True, "saved": saved, "errors": errors}


@app.post("/projects/{project_id}/sources/decide")
def decide_source(project_id: str, body: SourceDecisionBody):
    try:
        doc = P.load_json(project_id, "source/sources.json")
    except FileNotFoundError:
        raise HTTPException(404, "sources.json missing") from None
    target = None
    for s in doc.get("sources") or []:
        if s.get("source_id") == body.source_id:
            target = s
            break
    if not target:
        raise HTTPException(404, "source_id not found")
    before = {"user_confirmation": target.get("user_confirmation")}
    target["user_confirmation"] = body.user_confirmation
    if body.reason is not None:
        target["user_confirmation_reason"] = body.reason
    P.save_json(project_id, "source/sources.json", doc)
    P.append_decision(
        project_id,
        {
            "gate": "gate2_sources",
            "actor": {"kind": "user", "name": "studio"},
            "action": "confirm" if body.user_confirmation == "selected" else "reject",
            "ai_recommendation": target.get("screening_reason"),
            "user_choice": body.user_confirmation,
            "reason": body.reason,
            "before": before,
            "after": {"user_confirmation": body.user_confirmation},
            "affected_entities": [{"kind": "source", "id": body.source_id}],
            "invalidation_scope": [],
        },
    )
    return {"ok": True, "source_id": body.source_id, "user_confirmation": body.user_confirmation}


@app.get("/projects/{project_id}/figures")
def get_figures(project_id: str, reconcile: bool = True):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    reconcile_info = None
    if reconcile:
        try:
            reconcile_info = P.reconcile_figures(project_id)
        except Exception:
            reconcile_info = None
    try:
        doc = P.load_json(project_id, "source/figure_catalog.json")
    except FileNotFoundError:
        raise HTTPException(404, "figure_catalog.json missing") from None
    root = P.project_dir(project_id)

    # Map figure_id → which slides use it (page order is PPT 页码, not F00N).
    used_by: dict[str, list[dict]] = {}
    try:
        plan = P.load_json(project_id, "source/slide_plan.json")
        ordered = sorted(plan.get("slides") or [], key=lambda s: s.get("order") or 0)
        for i, s in enumerate(ordered):
            fid = (s.get("visual_plan") or {}).get("selected_figure_id")
            if not fid:
                continue
            used_by.setdefault(fid, []).append(
                {
                    "page_index": i + 1,
                    "page_id": s.get("page_id"),
                    "page_title": s.get("page_title"),
                }
            )
    except FileNotFoundError:
        used_by = {}

    rows = []
    for f in doc.get("figures") or []:
        crop = f.get("crop") or {}
        path = f.get("file_path") or crop.get("safe_path")
        exists = bool(path and (root / path).is_file())
        fig_id = f.get("figure_id") or ""
        label = f.get("original_label")
        caption_zh = (f.get("caption_zh") or "").strip()
        caption_en = (f.get("original_caption") or "").strip()
        pages = used_by.get(fig_id) or []
        rows.append(
            {
                "figure_id": fig_id,
                "figure_id_zh": P.zh_figure_id(fig_id),
                "figure_kind": f.get("figure_kind"),
                "figure_kind_zh": P.zh_figure_kind(f.get("figure_kind")),
                "source_id": f.get("source_id"),
                "original_label": label,
                "original_label_zh": P.zh_paper_figure_label(label),
                "rights_status": f.get("rights_status"),
                "license": f.get("license"),
                "human_confirmed": f.get("human_confirmed"),
                "mapped_knowledge_points": f.get("mapped_knowledge_points") or [],
                "used_on_pages": pages,
                "used_on_label": (
                    "、".join(f"第{p['page_index']}页" for p in pages) if pages else "库存图"
                ),
                "file_path": path,
                "has_file": exists,
                "caption_zh": caption_zh or None,
                "caption_en": caption_en[:500] if caption_en else None,
                "caption": P.ui_figure_caption(caption_zh=caption_zh, caption_en=caption_en, label=label),
                "thumb_url": (
                    (
                        f"/api/projects/{project_id}/artifact?path={quote(path)}"
                        f"&v={int((root / path).stat().st_mtime)}"
                    )
                    if exists and path
                    else None
                ),
            }
        )
    crop_rows = [r for r in rows if r["figure_kind"] == "source_crop"]
    ai_rows = [r for r in rows if r["figure_kind"] == "ai_scientific_illustration"]
    figs_by_id = {r["figure_id"]: r for r in rows if r.get("figure_id")}

    # 进度按「页」计，而不是图库里堆积的 AI 条目（未绑页会虚高）
    # 封面/议程/章节/小结/参考文献/致谢：不计入配图进度
    no_fig_roles = {"title", "agenda", "section", "summary", "references", "thanks"}
    crop_page_total = 0
    crop_page_done = 0
    ai_page_total = 0
    ai_page_done = 0
    try:
        plan = P.load_json(project_id, "source/slide_plan.json")
        for s in plan.get("slides") or []:
            role = s.get("page_role") or "content"
            if role in no_fig_roles:
                continue
            vp = s.get("visual_plan") or {}
            if (vp.get("resolution_status") or "") == "not_needed":
                continue
            fid = vp.get("selected_figure_id")
            fig = figs_by_id.get(fid) if fid else None
            kind = (fig or {}).get("figure_kind")
            if kind == "source_crop":
                crop_page_total += 1
                if fig and fig.get("has_file"):
                    crop_page_done += 1
            else:
                # 内容页默认走 AI / 其他示意图轨道（含尚未绑图）
                ai_page_total += 1
                if fig and fig.get("has_file"):
                    ai_page_done += 1
    except FileNotFoundError:
        crop_page_total = len(crop_rows)
        crop_page_done = sum(1 for r in crop_rows if r["has_file"])
        ai_page_total = len(ai_rows)
        ai_page_done = sum(1 for r in ai_rows if r["has_file"])

    return {
        "project_id": project_id,
        "figures": rows,
        "counts": {
            "total": len(rows),
            "with_file": sum(1 for r in rows if r["has_file"]),
            "source_crop": len(crop_rows),
            "ai": len(ai_rows),
            "crop_total": crop_page_total,
            "crop_done": crop_page_done,
            "ai_total": ai_page_total,
            "ai_done": ai_page_done,
        },
        "reconcile": reconcile_info,
    }


@app.delete("/projects/{project_id}/figures/{figure_id}")
def delete_figure(project_id: str, figure_id: str):
    """Delete a figure from catalog, clear slide bindings, remove files."""
    try:
        P.project_dir(project_id)
        result = P.delete_figure(project_id, figure_id)
    except FileNotFoundError:
        raise HTTPException(404, "project or figure_catalog missing") from None
    except KeyError:
        raise HTTPException(404, f"figure {figure_id} not found") from None
    return result


@app.post("/projects/{project_id}/figures/{figure_id}/translate-caption")
def translate_figure_caption(project_id: str, figure_id: str):
    """Translate English original_caption to caption_zh and persist."""
    try:
        P.project_dir(project_id)
        result = P.translate_and_store_caption(project_id, figure_id)
    except FileNotFoundError:
        raise HTTPException(404, "project or figure_catalog missing") from None
    except KeyError:
        raise HTTPException(404, f"figure {figure_id} not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from None
    return result


@app.get("/projects/{project_id}/visual-snapshots")
def list_visual_snapshots(project_id: str):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    snaps = P.list_visual_snapshots(project_id)
    return {"project_id": project_id, "snapshots": snaps, "count": len(snaps)}


@app.post("/projects/{project_id}/visual-snapshots/restore")
def restore_visual_snapshot(project_id: str, snapshot_id: str | None = None):
    """Restore previous figure_catalog / slide_plan / image files after a bad re-run."""
    try:
        P.project_dir(project_id)
        result = P.restore_visual_snapshot(project_id, snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    return {"ok": True, **result}

@app.get("/projects/{project_id}/outline-snapshots")
def list_outline_snapshots(project_id: str):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    snaps = P.list_outline_snapshots(project_id)
    return {"project_id": project_id, "snapshots": snaps, "count": len(snaps)}


@app.post("/projects/{project_id}/outline-snapshots/restore")
def restore_outline_snapshot(project_id: str, snapshot_id: str | None = None):
    try:
        P.project_dir(project_id)
        result = P.restore_outline_snapshot(project_id, snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    return {"ok": True, **result}

@app.put("/projects/{project_id}/outline")
async def put_outline(project_id: str, body: dict):
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    if body.get("project_id") and body["project_id"] != project_id:
        raise HTTPException(400, "project_id mismatch")
    body = dict(body)
    body.pop("_keep_confirmed", None)
    body.pop("_force_status", None)
    body["project_id"] = project_id
    # UI edits always return outline to draft; Gate 1 confirm sets user_confirmed.
    body["status"] = "draft"
    try:
        P.snapshot_outline_state(project_id, reason="before:save")
    except Exception:
        pass
    P.save_json(project_id, "source/outline.json", body)
    return {"ok": True, "status": body.get("status")}


@app.post("/projects/{project_id}/copilot/outline")
def copilot_outline(project_id: str, body: CopilotOutlineBody):
    """AI 副驾：按自然语言增删改大纲结构。"""
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        import copilot as C

        try:
            P.snapshot_outline_state(project_id, reason="before:copilot")
        except Exception:
            pass
        return C.edit_outline_with_copilot(project_id, body.message)
    except FileNotFoundError:
        raise HTTPException(404, "outline.json missing") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from None


@app.post("/projects/{project_id}/copilot/studio")
def copilot_studio(project_id: str, body: CopilotStudioBody):
    """侧栏 AI 副驾：按当前屏幕（大纲/文献/配图/预览）路由意图。"""
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        import copilot as C

        return C.handle_studio_copilot(
            project_id,
            body.screen,
            body.message,
            page_id=body.page_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from None


@app.post("/projects/{project_id}/copilot/figure")
def copilot_figure(project_id: str, body: CopilotFigureBody):
    """AI 副驾：把用户描述写入该页生图 prompt（随后前端再跑 fill --only）。"""
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        import copilot as C

        return C.set_figure_regen_prompt(project_id, body.page_id, body.message)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.get("/projects/{project_id}/copilot/figure/history")
def copilot_figure_history(project_id: str, page_id: str):
    """本页配图口述历史（点输入框可复用）。"""
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        import copilot as C

        return C.list_figure_prompt_history(project_id, page_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/projects/{project_id}/copilot/figure/clear")
def copilot_figure_clear(project_id: str, body: CopilotFigureClearBody):
    """清除副驾口述描述（内部自动调用；口述只作用于当次生成）。"""
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None
    try:
        import copilot as C

        return C.clear_figure_user_prompts(
            project_id, page_id=body.page_id, all_pages=body.all_pages
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/projects/{project_id}/gates/{gate}/confirm")
def confirm_gate(project_id: str, gate: str, body: GateConfirmBody):
    allowed = {
        "gate0_brief",
        "gate1_outline",
        "gate2_sources",
        "gate3_evidence_visual",
        "gate4_draft_deck",
        "qa_override",
    }
    if gate not in allowed:
        raise HTTPException(400, f"unknown gate; allowed={sorted(allowed)}")
    try:
        P.project_dir(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found") from None

    after = None
    if gate == "gate1_outline":
        outline = P.load_json(project_id, "source/outline.json")
        outline["status"] = body.outline_status or "user_confirmed"
        P.save_json(project_id, "source/outline.json", outline)
        after = {"outline_status": outline["status"]}

    P.append_decision(
        project_id,
        {
            "gate": gate,
            "actor": {"kind": "user", "name": "studio"},
            "action": "confirm",
            "ai_recommendation": None,
            "user_choice": body.user_choice,
            "reason": body.reason,
            "before": None,
            "after": after,
            "affected_entities": [],
            "invalidation_scope": [],
        },
    )
    return {"ok": True, "gate": gate, "after": after}


@app.post("/projects/{project_id}/jobs")
def create_job(project_id: str, body: JobBody):
    extra = {}
    if body.only:
        extra["only"] = body.only
    if body.skip_crop:
        extra["skip_crop"] = True
    if body.from_step:
        extra["from"] = body.from_step
    if body.pptx:
        extra["pptx"] = body.pptx
    if body.limit is not None:
        extra["limit"] = int(body.limit)
    try:
        job = J.start_job(project_id, body.step, extra or None)
    except FileNotFoundError:
        raise HTTPException(404, "project not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return job.to_dict()


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = J.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    job = J.cancel_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.get("/projects/{project_id}/jobs")
def project_jobs(project_id: str):
    return {"jobs": J.list_jobs(project_id)}


@app.get("/projects/{project_id}/qa")
def get_qa(project_id: str):
    try:
        return P.load_json(project_id, "qa_report.json")
    except FileNotFoundError:
        raise HTTPException(404, "qa_report.json missing — run deliver first") from None


@app.get("/projects/{project_id}/slides")
def get_slides(project_id: str):
    try:
        root = P.project_dir(project_id)
        plan = P.load_json(project_id, "source/slide_plan.json")
    except FileNotFoundError:
        raise HTTPException(404, "slide_plan.json missing") from None

    catalog = {}
    try:
        cat = P.load_json(project_id, "source/figure_catalog.json")
        catalog = {f.get("figure_id"): f for f in (cat.get("figures") or [])}
    except FileNotFoundError:
        catalog = {}

    export_dir = root / "deck" / "slide_exports"

    def artifact_url(rel: str) -> str:
        p = root / rel
        v = int(p.stat().st_mtime) if p.is_file() else 0
        return f"/api/projects/{project_id}/artifact?path={quote(rel)}&v={v}"

    slides = []
    ordered = sorted(plan.get("slides") or [], key=lambda s: s.get("order") or 0)
    for i, s in enumerate(ordered):
        vp = s.get("visual_plan") or {}
        fid = vp.get("selected_figure_id")
        fig = catalog.get(fid) if fid else None
        fig_path = None
        if fig:
            crop = fig.get("crop") or {}
            fig_path = fig.get("file_path") or crop.get("safe_path")
        fig_exists = bool(fig_path and (root / fig_path).is_file())
        export_name = f"slide_{i + 1:02d}.png"
        export_rel = f"deck/slide_exports/{export_name}"
        export_exists = (export_dir / export_name).is_file()
        slides.append(
            {
                "page_id": s.get("page_id"),
                "order": s.get("order"),
                "page_role": s.get("page_role"),
                "page_title": s.get("page_title"),
                "on_slide_text": s.get("on_slide_text") or [],
                "resolution_status": vp.get("resolution_status"),
                "selected_figure_id": fid,
                "layout": vp.get("layout"),
                "figure_thumb_url": artifact_url(fig_path) if fig_exists and fig_path else None,
                "export_thumb_url": artifact_url(export_rel) if export_exists else None,
            }
        )

    draft_path = root / "deck" / "draft-with-images.pptx"
    draft_plain_path = root / "deck" / "draft.pptx"
    final_path = root / "deck" / "final.pptx"
    draft = draft_path.is_file()
    draft_plain = draft_plain_path.is_file()
    final = final_path.is_file()

    # Download / preview source: newest pptx (avoid stale final after fill)
    pptx_candidates: list[tuple[str, float]] = []
    if draft:
        pptx_candidates.append(("deck/draft-with-images.pptx", draft_path.stat().st_mtime))
    if final:
        pptx_candidates.append(("deck/final.pptx", final_path.stat().st_mtime))
    if draft_plain:
        pptx_candidates.append(("deck/draft.pptx", draft_plain_path.stat().st_mtime))
    pptx_candidates.sort(key=lambda x: x[1], reverse=True)
    pptx_download = pptx_candidates[0][0] if pptx_candidates else None

    return {
        "project_id": project_id,
        "slides": slides,
        "count": len(slides),
        "has_draft": draft or draft_plain,
        "has_draft_with_images": draft,
        "has_final": final,
        "has_exports": export_dir.is_dir() and any(export_dir.glob("slide_*.png")),
        "pptx_download": pptx_download,
    }
