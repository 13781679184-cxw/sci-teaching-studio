"""Pack workspace/my-ppt into frontend/public/showcase for static resume demo."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "workspace" / "my-ppt"
OUT = ROOT / "frontend" / "public" / "showcase" / "my-ppt"
FILES = OUT / "files"

# studio backend on path
sys.path.insert(0, str(ROOT / "backend"))
import projects as P  # noqa: E402


def copy_file(rel: str) -> str | None:
    src = PROJECT / rel
    if not src.is_file():
        return None
    dest = FILES / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    # URL path under Vite base + public/
    return f"showcase/my-ppt/files/{rel.replace(chr(92), '/')}"


def main() -> None:
    if not PROJECT.is_dir():
        raise SystemExit(f"missing project: {PROJECT}")
    if OUT.exists():
        shutil.rmtree(OUT)
    FILES.mkdir(parents=True)

    # Ensure projects.py finds this workspace project
    # project_dir uses workspace_root()/id
    assert P.project_dir("my-ppt") == PROJECT.resolve() or P.project_dir("my-ppt").resolve() == PROJECT.resolve()

    outline = json.loads((PROJECT / "source" / "outline.json").read_text(encoding="utf-8"))
    sources_doc = json.loads((PROJECT / "source" / "sources.json").read_text(encoding="utf-8"))
    plan = json.loads((PROJECT / "source" / "slide_plan.json").read_text(encoding="utf-8"))
    catalog = json.loads((PROJECT / "source" / "figure_catalog.json").read_text(encoding="utf-8"))

    # theme / detail
    try:
        from deck.themes import load_project_theme_state

        state = load_project_theme_state(PROJECT)
        theme = state.resolved_theme()
        accent = state.resolved_accent()
        detail = {
            "id": "my-ppt",
            "project_id": "my-ppt",
            "course_title": outline.get("course_title") or "my-ppt",
            "audience": outline.get("audience"),
            "target_minutes": outline.get("target_minutes"),
            "theme_id": state.theme_id,
            "theme": {
                "id": state.theme_id,
                "name": theme.name if state.theme_id != "custom" else "自定义",
                "accent": accent,
                "board": theme.board,
            },
            "page_designs": {
                k: (state.designs or {}).get(k) or v
                for k, v in {
                    "title": "plain",
                    "agenda": "list",
                    "content": "chapter",
                    "section": "big_num",
                    "thanks": "centered",
                }.items()
            },
            "optional_pages": getattr(state, "optional_pages", None)
            or {"section_dividers": False, "thanks": False},
            "custom_accents": list(getattr(state, "custom_accents", None) or []),
            "artifacts": {
                "source/outline.json": True,
                "source/sources.json": True,
                "source/figure_catalog.json": True,
                "source/slide_plan.json": True,
                "deck/draft-with-images.pptx": (PROJECT / "deck" / "draft-with-images.pptx").is_file(),
                "deck/final.pptx": (PROJECT / "deck" / "final.pptx").is_file(),
                "lecture_script.md": (PROJECT / "lecture_script.md").is_file(),
            },
            "gates": {
                "gate1_outline": {"status": "confirmed"},
                "gate2_sources": {"status": "confirmed"},
                "gate3_evidence_visual": {"status": "confirmed"},
            },
        }
        theme_state = {
            "theme_id": state.theme_id,
            "accent": accent,
            "page_designs": detail["page_designs"],
            "optional_pages": detail["optional_pages"],
            "custom_accents": detail["custom_accents"],
            "designs": detail["page_designs"],
            "theme": detail["theme"],
        }
    except Exception as exc:  # noqa: BLE001
        print("theme load fallback:", exc)
        detail = {
            "id": "my-ppt",
            "project_id": "my-ppt",
            "course_title": outline.get("course_title") or "my-ppt",
            "audience": outline.get("audience"),
            "target_minutes": outline.get("target_minutes"),
            "theme_id": "green",
            "theme": {"id": "green", "name": "松叶绿", "accent": "#2F5D50", "board": "white"},
            "page_designs": {
                "title": "plain",
                "agenda": "list",
                "content": "chapter",
                "section": "big_num",
                "thanks": "centered",
            },
            "optional_pages": {"section_dividers": False, "thanks": False},
            "custom_accents": [],
            "artifacts": {
                "source/outline.json": True,
                "source/sources.json": True,
                "source/figure_catalog.json": True,
                "source/slide_plan.json": True,
                "deck/draft-with-images.pptx": True,
                "lecture_script.md": (PROJECT / "lecture_script.md").is_file(),
            },
            "gates": {
                "gate1_outline": {"status": "confirmed"},
                "gate2_sources": {"status": "confirmed"},
                "gate3_evidence_visual": {"status": "confirmed"},
            },
        }
        theme_state = {
            "theme_id": "green",
            "accent": "#2F5D50",
            "page_designs": detail["page_designs"],
            "optional_pages": detail["optional_pages"],
            "designs": detail["page_designs"],
            "theme": detail["theme"],
        }

    # sources rows (lightweight, match API fields used by UI)
    src_rows = []
    counts = {"total": 0, "selected": 0, "proposed": 0, "rejected": 0}
    for s in sources_doc.get("sources") or []:
        conf = s.get("user_confirmation") or "proposed"
        counts["total"] += 1
        counts[conf] = counts.get(conf, 0) + 1
        src_rows.append(s)
    sources_pack = {"project_id": "my-ppt", "sources": src_rows, "counts": counts}

    # figures
    used_by: dict[str, list] = {}
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

    fig_rows = []
    for f in catalog.get("figures") or []:
        crop = f.get("crop") or {}
        path = f.get("file_path") or crop.get("safe_path")
        url = copy_file(path) if path else None
        pages = used_by.get(f.get("figure_id") or "", [])
        kind = f.get("figure_kind")
        fig_rows.append(
            {
                "figure_id": f.get("figure_id"),
                "figure_kind": kind,
                "figure_kind_zh": {
                    "source_crop": "论文裁图",
                    "ai_scientific_illustration": "AI 科学示意图",
                }.get(kind or "", kind),
                "source_id": f.get("source_id"),
                "used_on_pages": pages,
                "used_on_label": ("、".join(f"第{p['page_index']}页" for p in pages) if pages else "库存图"),
                "file_path": path,
                "has_file": bool(url),
                "caption": (f.get("caption_zh") or f.get("original_caption") or "")[:500],
                "caption_zh": f.get("caption_zh"),
                "caption_en": (f.get("original_caption") or "")[:500] or None,
                "thumb_url": url,
            }
        )

    figs_by_id = {r["figure_id"]: r for r in fig_rows if r.get("figure_id")}
    no_fig = {"title", "agenda", "section", "summary", "references", "thanks"}
    crop_t = crop_d = ai_t = ai_d = 0
    for s in plan.get("slides") or []:
        role = s.get("page_role") or "content"
        if role in no_fig:
            continue
        vp = s.get("visual_plan") or {}
        if (vp.get("resolution_status") or "") == "not_needed":
            continue
        fid = vp.get("selected_figure_id")
        fig = figs_by_id.get(fid) if fid else None
        kind = (fig or {}).get("figure_kind")
        if kind == "source_crop":
            crop_t += 1
            if fig and fig.get("has_file"):
                crop_d += 1
        else:
            ai_t += 1
            if fig and fig.get("has_file"):
                ai_d += 1

    figures_pack = {
        "project_id": "my-ppt",
        "figures": fig_rows,
        "counts": {
            "total": len(fig_rows),
            "with_file": sum(1 for r in fig_rows if r["has_file"]),
            "source_crop": sum(1 for r in fig_rows if r["figure_kind"] == "source_crop"),
            "ai": sum(1 for r in fig_rows if r["figure_kind"] == "ai_scientific_illustration"),
            "crop_total": crop_t,
            "crop_done": crop_d,
            "ai_total": ai_t,
            "ai_done": ai_d,
        },
    }

    # slides
    slide_rows = []
    for i, s in enumerate(ordered):
        vp = s.get("visual_plan") or {}
        fid = vp.get("selected_figure_id")
        fig = figs_by_id.get(fid) if fid else None
        export_rel = f"deck/slide_exports/slide_{i + 1:02d}.png"
        export_url = copy_file(export_rel)
        slide_rows.append(
            {
                "page_id": s.get("page_id"),
                "order": s.get("order"),
                "page_role": s.get("page_role"),
                "page_title": s.get("page_title"),
                "key_message": s.get("key_message"),
                "on_slide_text": s.get("on_slide_text") or [],
                "resolution_status": vp.get("resolution_status"),
                "selected_figure_id": fid,
                "layout": vp.get("layout"),
                "visual_plan": vp,
                "figure_thumb_url": (fig or {}).get("thumb_url"),
                "export_thumb_url": export_url,
            }
        )
    slides_pack = {
        "project_id": "my-ppt",
        "count": len(slide_rows),
        "has_exports": any(s.get("export_thumb_url") for s in slide_rows),
        "slides": slide_rows,
    }

    lecture = ""
    lp = PROJECT / "lecture_script.md"
    if lp.is_file():
        lecture = lp.read_text(encoding="utf-8")
        copy_file("lecture_script.md")

    # Allow「下载 PPT / 讲稿」on the static demo (demoApi maps artifact paths here).
    copy_file("deck/final.pptx")

    qa = {"project_id": "my-ppt", "status": "pass", "summary": "静态展示快照", "checks": []}
    qp = PROJECT / "qa_report.json"
    if qp.is_file():
        try:
            qa = json.loads(qp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    pack = {
        "project_id": "my-ppt",
        "packed_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "detail": detail,
        "theme": theme_state,
        "outline": outline,
        "sources": sources_pack,
        "figures": figures_pack,
        "slides": slides_pack,
        "lecture": lecture,
        "qa": qa,
        "list": [
            {
                "id": "my-ppt",
                "course_title": detail["course_title"],
                "audience": detail.get("audience"),
                "has_final": bool(detail["artifacts"].get("deck/final.pptx")),
            }
        ],
    }
    (OUT / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_files = sum(1 for _ in FILES.rglob("*") if _.is_file())
    size = sum(p.stat().st_size for p in FILES.rglob("*") if p.is_file())
    print(f"wrote {OUT}")
    print(f"files={n_files} size_mb={size / 1e6:.1f} slides={len(slide_rows)} figures={len(fig_rows)}")


if __name__ == "__main__":
    # deck on path for themes
    deck = Path(r"C:\Users\寸寸\Desktop\ai ppt agent\sci-teaching-deck")
    sys.path.insert(0, str(deck))
    main()
