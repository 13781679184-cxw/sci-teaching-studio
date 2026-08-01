"""BYO AI providers — OpenAI-compatible text + image. Not locked to Bailian.

Keys may live in browser (draft) and optionally persist to
workspace/_settings/providers.json (local mode, 0600).
Never log or return plaintext keys.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import projects as P

TENANCY = (os.environ.get("STUDIO_TENANCY") or "local").strip().lower()
if TENANCY not in ("local", "shared"):
    TENANCY = "local"

IMAGE_PROVIDERS = ("none", "openai_compat", "bailian")

# Literature / retrieval keys (same names as ~/.aut_sci_write/.env)
LIT_SECRET_KEYS = (
    "NCBI_API_KEY",
    "SPRINGER_API_KEY",
    "SPRINGER_OA_API_KEY",
    "WOS_API_KEY",
    "SCOPUS_API_KEY",
    "SEMANTIC_SCHOLAR_API_KEY",
    "ELSEVIER_API_KEY",
    "GOOGLE_BOOKS_API_KEY",
)
LIT_PLAIN_KEYS = (
    "NCBI_EMAIL",
    "OPENALEX_EMAIL",
    "UNPAYWALL_EMAIL",
)
LIT_KEYS = LIT_SECRET_KEYS + LIT_PLAIN_KEYS


def settings_path() -> Path:
    return P.workspace_root() / "_settings" / "providers.json"


def aut_sci_env_path() -> Path:
    override = os.environ.get("AUT_SCI_WRITE_ENV_DIR")
    root = Path(override) if override else Path.home() / ".aut_sci_write"
    return root / ".env"


def mask(key: str) -> str:
    if not key:
        return ""
    k = str(key)
    if len(k) <= 8:
        return "•" * len(k)
    return f"{k[:3]}…{k[-4:]}"


def _load_local() -> dict[str, Any]:
    path = settings_path()
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        pass
    return {}


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        if tmp.is_file() and tmp != path:
            try:
                tmp.unlink()
            except OSError:
                pass


def _parse_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        if not path.is_file():
            return out
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if not k:
                continue
            out[k] = v.strip().strip("\"'")
    except Exception:  # noqa: BLE001
        pass
    return out


def _load_aut_sci_literature() -> dict[str, str]:
    raw = _parse_dotenv(aut_sci_env_path())
    return {k: (raw.get(k) or "").strip() for k in LIT_KEYS if (raw.get(k) or "").strip()}


def _sync_aut_sci_env(lit: dict[str, Any]) -> None:
    """Mirror literature keys into ~/.aut_sci_write/.env (Aut_Sci_Write contract)."""
    path = aut_sci_env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = _parse_dotenv(path) if path.is_file() else {}
    for k in LIT_KEYS:
        val = str((lit or {}).get(k) or "").strip()
        if val:
            existing[k] = val

    if not path.is_file():
        lines = [
            "# Aut_Sci_Write — synced from Sci Teaching Studio 「模型能力」",
            "",
        ]
        for k in LIT_KEYS:
            lines.append(f"{k}={existing.get(k, '')}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    found: set[str] = set()
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in LIT_KEYS and key in existing:
                out_lines.append(f"{key}={existing[key]}")
                found.add(key)
                continue
        out_lines.append(line)
    for k in LIT_KEYS:
        if k in existing and k not in found:
            out_lines.append(f"{k}={existing[k]}")
    path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")


def _env_defaults() -> dict[str, Any]:
    text: dict[str, Any] = {}
    if os.environ.get("OPENAI_API_KEY") or os.environ.get("SCI_TEXT_API_KEY"):
        text = {
            "base_url": (
                os.environ.get("OPENAI_BASE_URL")
                or os.environ.get("SCI_TEXT_BASE_URL")
                or ""
            ).strip(),
            "api_key": (
                os.environ.get("OPENAI_API_KEY") or os.environ.get("SCI_TEXT_API_KEY") or ""
            ).strip(),
            "model": (
                os.environ.get("OPENAI_MODEL")
                or os.environ.get("SCI_TEXT_MODEL")
                or os.environ.get("BAILIAN_TEXT_MODEL")
                or ""
            ).strip(),
        }
    image: dict[str, Any] = {"provider": "none"}
    if os.environ.get("SCI_IMAGE_API_KEY") or os.environ.get("OPENAI_IMAGE_API_KEY"):
        image = {
            "provider": "openai_compat",
            "base_url": (
                os.environ.get("SCI_IMAGE_BASE_URL")
                or os.environ.get("OPENAI_IMAGE_BASE_URL")
                or os.environ.get("OPENAI_BASE_URL")
                or ""
            ).strip(),
            "api_key": (
                os.environ.get("SCI_IMAGE_API_KEY")
                or os.environ.get("OPENAI_IMAGE_API_KEY")
                or ""
            ).strip(),
            "model": (
                os.environ.get("SCI_IMAGE_MODEL") or os.environ.get("OPENAI_IMAGE_MODEL") or ""
            ).strip(),
        }
    elif os.environ.get("BAILIAN_IMAGE_MODEL") or os.environ.get("DASHSCOPE_API_KEY"):
        image = {
            "provider": "bailian",
            "base_url": "",
            "api_key": (os.environ.get("DASHSCOPE_API_KEY") or "").strip(),
            "model": (os.environ.get("BAILIAN_IMAGE_MODEL") or "qwen-image-plus").strip(),
        }

    literature: dict[str, str] = dict(_load_aut_sci_literature())
    for k in LIT_KEYS:
        if literature.get(k):
            continue
        ev = (os.environ.get(k) or "").strip()
        if ev:
            literature[k] = ev
    return {"text": text, "image": image, "literature": literature}


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for sec in ("text", "image", "literature"):
        if over.get(sec):
            merged = dict(base.get(sec) or {})
            for k, v in (over[sec] or {}).items():
                if v not in (None, ""):
                    merged[k] = v
            out[sec] = merged
    return out


def resolve_local() -> dict[str, Any]:
    return _merge(_env_defaults(), _load_local())


def resolve(header_json: str | None = None) -> dict[str, Any]:
    base = resolve_local()
    if header_json:
        try:
            over = json.loads(header_json)
            if isinstance(over, dict):
                base = _merge(base, over)
        except Exception:  # noqa: BLE001
            pass
    return base


def _block_public(b: dict[str, Any] | None) -> dict[str, Any]:
    b = b or {}
    key = b.get("api_key") or ""
    provider = b.get("provider") or ""
    return {
        "provider": provider,
        "model": b.get("model") or "",
        "base_url": b.get("base_url") or "",
        "configured": bool(key) or provider == "bailian",
        "masked": mask(str(key)),
    }


def _lit_public(lit: dict[str, Any] | None) -> dict[str, Any]:
    lit = lit or {}
    fields: dict[str, Any] = {}
    for k in LIT_KEYS:
        val = str(lit.get(k) or "").strip()
        if k in LIT_PLAIN_KEYS:
            fields[k] = {"value": val, "configured": bool(val)}
        else:
            fields[k] = {
                "configured": bool(val),
                "masked": mask(val),
            }
    # "configured" for chip: any useful optional key or email filled
    useful = (
        "SPRINGER_API_KEY",
        "SPRINGER_OA_API_KEY",
        "NCBI_API_KEY",
        "WOS_API_KEY",
        "SEMANTIC_SCHOLAR_API_KEY",
        "SCOPUS_API_KEY",
        "NCBI_EMAIL",
        "OPENALEX_EMAIL",
    )
    configured = any(str(lit.get(k) or "").strip() for k in useful)
    return {"configured": configured, "fields": fields}


def public_state() -> dict[str, Any]:
    cfg = resolve_local()
    t = _block_public(cfg.get("text"))
    # text has no provider field historically — treat key as configured
    t["configured"] = bool((cfg.get("text") or {}).get("api_key"))
    im = _block_public(cfg.get("image"))
    if (cfg.get("image") or {}).get("provider") == "bailian":
        im["configured"] = True
    lit = _lit_public(cfg.get("literature"))
    return {
        "tenancy": TENANCY,
        "persist_allowed": TENANCY == "local",
        "capabilities": {
            "text": t["configured"],
            "image": im["configured"] and im.get("provider") not in ("", "none"),
            "literature": lit["configured"],
        },
        "text": t,
        "image": im,
        "literature": lit,
    }


def validate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("payload 必须是对象")
    out: dict[str, Any] = {}
    if isinstance(payload.get("text"), dict):
        t = payload["text"]
        out["text"] = {
            "base_url": str(t.get("base_url") or "").strip().rstrip("/"),
            "api_key": str(t.get("api_key") or "").strip(),
            "model": str(t.get("model") or "").strip(),
        }
    if isinstance(payload.get("image"), dict):
        im = payload["image"]
        prov = str(im.get("provider") or "none").strip().lower()
        if prov not in IMAGE_PROVIDERS:
            raise ValueError(f"未知 image provider：{prov}")
        out["image"] = {
            "provider": prov,
            "base_url": str(im.get("base_url") or "").strip().rstrip("/"),
            "api_key": str(im.get("api_key") or "").strip(),
            "model": str(im.get("model") or "").strip(),
        }
    if isinstance(payload.get("literature"), dict):
        lit_in = payload["literature"]
        lit_out: dict[str, str] = {}
        for k in LIT_KEYS:
            if k in lit_in:
                lit_out[k] = str(lit_in.get(k) or "").strip()
        out["literature"] = lit_out
    return out


def save(payload: dict[str, Any]) -> dict[str, Any]:
    if TENANCY != "local":
        raise PermissionError("shared 模式不在服务端保存 key")
    clean = validate_payload(payload)
    # keep previous key if UI sent empty (masked edit without retype)
    prev = _load_local()
    for sec in ("text", "image"):
        if sec not in clean:
            continue
        if not clean[sec].get("api_key") and (prev.get(sec) or {}).get("api_key"):
            clean[sec]["api_key"] = prev[sec]["api_key"]
    if "literature" in clean:
        prev_lit = dict(prev.get("literature") or {})
        # also seed from existing ~/.aut_sci_write/.env so we don't wipe known keys
        for k, v in _load_aut_sci_literature().items():
            prev_lit.setdefault(k, v)
        merged_lit = dict(prev_lit)
        for k, v in clean["literature"].items():
            if v:
                merged_lit[k] = v
            # empty => keep previous
        clean["literature"] = {k: merged_lit.get(k, "") for k in LIT_KEYS if merged_lit.get(k)}
        # Preserve sections not in this save
    # Keep other sections from prev if not in this payload
    for sec in ("text", "image", "literature"):
        if sec not in clean and prev.get(sec):
            clean[sec] = prev[sec]
    _atomic_write(settings_path(), json.dumps(clean, ensure_ascii=False, indent=2) + "\n")
    if clean.get("literature"):
        try:
            _sync_aut_sci_env(clean["literature"])
        except Exception:  # noqa: BLE001
            pass
    return public_state()


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, Any]:
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw) if raw else {"error": str(exc)}
        except json.JSONDecodeError:
            return exc.code, {"error": raw[:400] or str(exc)}
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": f"{type(exc).__name__}: {exc}"}


def normalize_openai_base(base_url: str) -> str:
    u = (base_url or "").strip().rstrip("/")
    if not u:
        return "https://api.openai.com/v1"
    # Allow users to paste root or /v1
    if u.endswith("/chat/completions"):
        u = u[: -len("/chat/completions")]
    if not u.endswith("/v1") and "/v1/" not in u + "/":
        # many gateways need /v1; if user gave bare host, append
        if u.count("/") <= 2:
            u = u + "/v1"
    return u.rstrip("/")


def list_models(base_url: str, api_key: str, limit: int = 300) -> list[str]:
    base = normalize_openai_base(base_url)
    code, data = _http_json(
        "GET",
        f"{base}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=20,
    )
    if code != 200 or not isinstance(data, dict):
        err = data if isinstance(data, dict) else {}
        raise RuntimeError(err.get("error") or f"HTTP {code}")
    ids = []
    for m in data.get("data") or []:
        mid = m.get("id") if isinstance(m, dict) else None
        if mid:
            ids.append(str(mid))
    return sorted(ids)[:limit]


def test_connection(
    kind: str,
    *,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
    provider: str = "",
) -> dict[str, Any]:
    kind = (kind or "").strip().lower()
    provider = (provider or "").strip().lower()

    if kind == "text":
        if not api_key:
            return {"ok": False, "detail": "未填 API Key", "models": []}
        try:
            models = list_models(base_url, api_key)
            return {
                "ok": True,
                "detail": f"鉴权通过 · 取到 {len(models)} 个模型",
                "models": models,
            }
        except Exception as exc:  # noqa: BLE001
            # Some gateways don't expose /models — try a tiny chat
            base = normalize_openai_base(base_url)
            code, data = _http_json(
                "POST",
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                body={
                    "model": model or "gpt-4o-mini",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 8,
                },
                timeout=25,
            )
            if code and 200 <= code < 300:
                return {
                    "ok": True,
                    "detail": "鉴权通过（端点无 /models，已用 chat 探测）",
                    "models": [model] if model else [],
                }
            detail = ""
            if isinstance(data, dict):
                err = data.get("error")
                detail = err.get("message") if isinstance(err, dict) else str(err or data)[:200]
            return {
                "ok": False,
                "detail": f"校验失败：{detail or exc}"[:240],
                "models": [],
            }

    if kind == "image":
        if provider == "bailian":
            return {
                "ok": True,
                "detail": "百炼走本机 bl CLI / DashScope；保存后任务会优先用配置的模型名",
            }
        if provider in ("", "none"):
            return {"ok": False, "detail": "未选择图片 provider"}
        if not api_key:
            return {"ok": False, "detail": "未填 API Key"}
        base = normalize_openai_base(base_url)
        # Prefer /models; else accept configured
        try:
            list_models(base, api_key, limit=3)
            return {"ok": True, "detail": "鉴权通过（OpenAI 兼容）"}
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": True,
                "detail": f"已记录配置（/models 不可用：{exc}）。生图时再实调 /images/generations",
            }

    if kind == "literature":
        # Probe free OpenAlex; optionally Springer if key present in request payload
        # (api_key field reused as SPRINGER_API_KEY when provider=springer)
        bits: list[str] = []
        code, data = _http_json(
            "GET",
            "https://api.openalex.org/works?search=biology&per-page=1",
            headers={"User-Agent": "sci-teaching-studio"},
            timeout=15,
        )
        if code and 200 <= code < 300:
            bits.append("OpenAlex 可达")
        else:
            bits.append(f"OpenAlex 探测失败 HTTP {code}")

        springer_key = (api_key or "").strip()
        if springer_key and provider in ("", "springer", "literature"):
            sc, _ = _http_json(
                "GET",
                f"https://api.springernature.com/meta/v2/json?q=biology&p=1&api_key={springer_key}",
                timeout=15,
            )
            if sc and 200 <= sc < 300:
                bits.append("Springer Meta 鉴权通过")
            else:
                bits.append(f"Springer Meta HTTP {sc or '失败'}")

        ok = any("可达" in b or "通过" in b for b in bits)
        return {"ok": ok, "detail": " · ".join(bits)}

    return {"ok": False, "detail": f"未知 kind：{kind}"}


def job_env_overrides(cfg: dict[str, Any] | None = None) -> dict[str, str]:
    """Env injected into deck subprocesses so llm/image pick BYO endpoints."""
    cfg = cfg or resolve_local()
    env: dict[str, str] = {}
    text = cfg.get("text") or {}
    if text.get("api_key"):
        env["SCI_TEXT_API_KEY"] = str(text["api_key"])
        env["OPENAI_API_KEY"] = str(text["api_key"])
        if text.get("base_url"):
            env["SCI_TEXT_BASE_URL"] = str(text["base_url"])
            env["OPENAI_BASE_URL"] = str(text["base_url"])
        if text.get("model"):
            env["SCI_TEXT_MODEL"] = str(text["model"])
            env["OPENAI_MODEL"] = str(text["model"])
            env["BAILIAN_TEXT_MODEL"] = str(text["model"])

    image = cfg.get("image") or {}
    prov = (image.get("provider") or "none").lower()
    if prov == "openai_compat" and image.get("api_key"):
        env["SCI_IMAGE_PROVIDER"] = "openai_compat"
        env["SCI_IMAGE_API_KEY"] = str(image["api_key"])
        if image.get("base_url"):
            env["SCI_IMAGE_BASE_URL"] = str(image["base_url"])
        if image.get("model"):
            env["SCI_IMAGE_MODEL"] = str(image["model"])
            env["BAILIAN_IMAGE_MODEL"] = str(image["model"])
    elif prov == "bailian":
        env["SCI_IMAGE_PROVIDER"] = "bailian"
        if image.get("model"):
            env["BAILIAN_IMAGE_MODEL"] = str(image["model"])
            env["SCI_IMAGE_MODEL"] = str(image["model"])
        if image.get("api_key"):
            env["DASHSCOPE_API_KEY"] = str(image["api_key"])

    lit = cfg.get("literature") or {}
    for k in LIT_KEYS:
        val = str(lit.get(k) or "").strip()
        if val:
            env[k] = val
    return env
