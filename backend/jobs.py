"""Background job runner — subprocess into sci-teaching-deck scripts."""

from __future__ import annotations

import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from projects import deck_root, project_dir, python_exe

JOBS: dict[str, "Job"] = {}
_LOCK = threading.Lock()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


ALLOWED_STEPS = {
    "generate_outline": ["scripts/generate_outline.py", "{project}"],
    "retrieve": [
        "scripts/retrieve_sources.py",
        "{project}",
        "--limit",
        "3",
        "--papers-only",
        "--paper-channels",
        "openalex,pubmed",
    ],
    "screen": ["scripts/screen_sources.py", "{project}"],
    "confirm_sources": ["scripts/confirm_sources.py", "{project}", "--accept-keeps", "--accept-maybes"],
    "extract": ["scripts/extract_evidence.py", "{project}"],
    "plan_figures": ["scripts/plan_figures.py", "{project}"],
    "confirm_figures": ["scripts/confirm_figures.py", "{project}"],
    "crop": ["scripts/crop_source_figures.py", "{project}", "--max-sources", "6", "--max-figures-per-source", "2"],
    "draft": ["scripts/draft_deck.py", "{project}"],
    "fill": ["scripts/fill_visuals.py", "{project}", "--generate", "--jobs", "1", "--model", "qwen-image-plus"],
    "fill_skip_resolved": [
        "scripts/fill_visuals.py",
        "{project}",
        "--generate",
        "--skip-resolved",
        "--jobs",
        "1",
        "--model",
        "qwen-image-plus",
    ],
    "deliver": ["scripts/deliver.py", "{project}", "--allow-warnings", "--force"],
    "validate": ["scripts/validate_contracts.py", "{project}", "--json"],
    "run_default_pipeline": ["scripts/run_default_pipeline.py", "{project}", "--jobs", "1", "--max-sources", "6"],
    "prune": ["scripts/prune_figure_catalog.py", "{project}", "--dry-run"],
    "export_slides": ["scripts/export_slide_previews.py", "{project}"],
    "rerender": ["scripts/rerender_pptx.py", "{project}"],
    "lecture_script": ["scripts/generate_lecture_script.py", "{project}"],
}

# Multi-step jobs run sequentially; fail-fast on first non-zero exit.
CHAINED_STEPS = {
    "retrieve_screen": ["retrieve", "screen"],
    # Theme / layout change: rebuild PPTX then export PNG previews
    "rerender_export": ["rerender", "export_slides"],
}


def known_steps() -> list[str]:
    return sorted({*ALLOWED_STEPS, *CHAINED_STEPS})


def _jobs_log_dir() -> Path:
    from projects import workspace_root

    d = workspace_root() / "_job_logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


@dataclass
class Job:
    job_id: str
    project_id: str
    step: str
    status: str = "queued"  # queued|running|ok|error|cancelled
    created_at: str = field(default_factory=utc_now_iso)
    finished_at: str | None = None
    returncode: int | None = None
    log: str = ""
    cmd: list[str] = field(default_factory=list)
    cancel_requested: bool = False
    _proc: Any = field(default=None, repr=False, compare=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "project_id": self.project_id,
            "step": self.step,
            "status": self.status,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "returncode": self.returncode,
            "log_tail": self.log[-4000:],
            "cmd": self.cmd,
            "cancel_requested": self.cancel_requested,
        }


def _terminate_process(proc: subprocess.Popen[Any] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        import sys

        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def cancel_job(job_id: str) -> Job | None:
    with _LOCK:
        job = JOBS.get(job_id)
    if not job:
        return None
    if job.status not in {"queued", "running"}:
        return job
    job.cancel_requested = True
    _terminate_process(job._proc)
    if job.status in {"queued", "running"}:
        job.status = "cancelled"
        job.finished_at = utc_now_iso()
        job.returncode = job.returncode if job.returncode is not None else -15
        job.log = (job.log or "") + "\n[studio] cancelled by user\n"
    return job


def _build_cmd(step: str, project_id: str, extra: dict[str, Any] | None = None) -> list[str]:
    if step not in ALLOWED_STEPS:
        raise ValueError(f"unknown step: {step}; allowed={known_steps()}")
    proj = str(project_dir(project_id))
    tmpl = list(ALLOWED_STEPS[step])
    argv = [str(python_exe())]
    for part in tmpl:
        argv.append(part.replace("{project}", proj))
    extra = extra or {}
    if step == "retrieve":
        limit = str(extra.get("limit") or 3)
        try:
            i = argv.index("--limit")
            argv[i + 1] = limit
        except ValueError:
            argv.extend(["--limit", limit])
    if step in {"fill", "fill_skip_resolved"} and extra.get("only"):
        only = extra["only"]
        if isinstance(only, str):
            only = [p.strip() for p in only.split(",") if p.strip()]
        for pid in only:
            argv.extend(["--only", str(pid)])
    if step == "export_slides" and extra.get("pptx"):
        argv.extend(["--pptx", str(extra["pptx"])])
    if step == "rerender" and extra.get("pptx"):
        argv.extend(["--pptx", str(extra["pptx"])])
    if step == "lecture_script" and extra.get("pptx"):
        argv.extend(["--pptx", str(extra["pptx"])])
    if step == "lecture_script" and extra.get("only"):
        only = extra["only"]
        if isinstance(only, str):
            only = [p.strip() for p in only.split(",") if p.strip()]
        for pid in only:
            argv.extend(["--only", str(pid)])
    if step == "run_default_pipeline" and extra.get("skip_crop"):
        argv.append("--skip-crop")
    if step == "run_default_pipeline" and extra.get("from"):
        argv.extend(["--from", str(extra["from"])])
    return argv


def _resolve_cmds(step: str, project_id: str, extra: dict[str, Any] | None = None) -> list[tuple[str, list[str]]]:
    if step in CHAINED_STEPS:
        return [(sub, _build_cmd(sub, project_id, extra)) for sub in CHAINED_STEPS[step]]
    if step in ALLOWED_STEPS:
        return [(step, _build_cmd(step, project_id, extra))]
    raise ValueError(f"unknown step: {step}; allowed={known_steps()}")


def start_job(project_id: str, step: str, extra: dict[str, Any] | None = None) -> Job:
    # resolve project early
    project_dir(project_id)
    import os as _os
    import time

    import projects as P

    snap_note = ""
    if P.should_snapshot_before_step(step):
        try:
            meta = P.snapshot_visual_state(project_id, reason=f"before:{step}")
            if meta:
                snap_note = f"[studio] snapshot {meta['id']} before {step}\n"
        except Exception as exc:  # noqa: BLE001
            snap_note = f"[studio] snapshot failed: {exc}\n"

    job_id = uuid.uuid4().hex[:12]
    cmds = _resolve_cmds(step, project_id, extra)
    flat_cmd = cmds[0][1] if len(cmds) == 1 else ["chain", step, *[c[0] for c in cmds]]
    job = Job(job_id=job_id, project_id=project_id, step=step, cmd=flat_cmd)
    job.log = snap_note
    with _LOCK:
        JOBS[job_id] = job

    def _run() -> None:
        job.status = "running"
        log_path = _jobs_log_dir() / f"{project_id}_{job.created_at.replace(':', '')}_{job_id}_{step}.log"
        finished_log = snap_note
        try:
            env = {**dict(_os.environ), "PYTHONUTF8": "1", "BAILIAN_IMAGE_MODEL": "qwen-image-plus"}
            try:
                import providers as PV

                env.update(PV.job_env_overrides())
            except Exception:
                pass
            flag = "--dns-result-order=ipv4first"
            no = (env.get("NODE_OPTIONS") or "").strip()
            if flag not in no:
                env["NODE_OPTIONS"] = f"{no} {flag}".strip()

            for sub_name, cmd in cmds:
                if job.cancel_requested:
                    job.status = "cancelled"
                    break
                if len(cmds) > 1:
                    finished_log += f"\n[studio] —— {sub_name} ——\n"
                    job.log = finished_log

                proc = subprocess.Popen(
                    cmd,
                    cwd=str(deck_root()),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    bufsize=1,
                )
                job._proc = proc
                chunk_parts: list[str] = []

                def _reader() -> None:
                    assert proc.stdout is not None
                    for line in proc.stdout:
                        chunk_parts.append(line)
                        job.log = finished_log + "".join(chunk_parts)

                reader = threading.Thread(target=_reader, daemon=True)
                reader.start()
                while proc.poll() is None:
                    if job.cancel_requested:
                        _terminate_process(proc)
                        break
                    time.sleep(0.4)
                reader.join(timeout=8)
                job._proc = None
                chunk = "".join(chunk_parts)
                finished_log += chunk
                rc = proc.returncode
                job.returncode = rc
                if len(cmds) > 1:
                    finished_log += f"\n[studio] —— {sub_name} done code={rc} ——\n"
                job.log = finished_log

                if job.cancel_requested:
                    job.status = "cancelled"
                    break
                if rc != 0:
                    job.status = "error"
                    break
            else:
                if not job.cancel_requested:
                    job.status = "ok"
        except Exception as exc:  # noqa: BLE001
            job.status = "cancelled" if job.cancel_requested else "error"
            job.log = (job.log or "") + str(exc)
            job.returncode = -1
        finally:
            job._proc = None
            if job.cancel_requested and job.status == "running":
                job.status = "cancelled"
            job.finished_at = utc_now_iso()
            try:
                log_path.write_text(
                    f"# {job.cmd}\n# status={job.status} code={job.returncode}\n\n{job.log}",
                    encoding="utf-8",
                )
                job.log = (job.log or "") + f"\n[studio] log file: {log_path}"
            except OSError:
                pass

    threading.Thread(target=_run, daemon=True).start()
    return job


def get_job(job_id: str) -> Job | None:
    return JOBS.get(job_id)


def list_jobs(project_id: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
    items = list(JOBS.values())
    if project_id:
        items = [j for j in items if j.project_id == project_id]
    items.sort(key=lambda j: j.created_at, reverse=True)
    return [j.to_dict() for j in items[:limit]]
