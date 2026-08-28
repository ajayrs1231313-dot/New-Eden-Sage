from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import modal

_HERE = Path(__file__).resolve()
ROOT = _HERE.parents[2] if len(_HERE.parents) > 2 and (_HERE.parents[2] / "package.json").exists() else Path("/app")
PUBLISHED_VOLUME_NAME = "new-eden-sage-market-trial"
HISTORY_VOLUME_NAME = "new-eden-sage-public-history"
HISTORY_RETENTION_DAYS = int(os.environ.get("NEW_EDEN_SAGE_PUBLIC_HISTORY_RETENTION_DAYS", "120"))

app = modal.App("new-eden-sage-market-benchmark")
published_volume = modal.Volume.from_name(PUBLISHED_VOLUME_NAME, create_if_missing=True)
history_volume = modal.Volume.from_name(HISTORY_VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .pip_install("fastapi>=0.115,<1")
    .run_commands("mkdir -p /app && cd /app && npm init -y >/dev/null 2>&1 && npm install adm-zip@0.6.0 >/dev/null 2>&1")
    .add_local_dir(str(ROOT / "dist-electron"), remote_path="/app/dist-electron")
    .add_local_dir(str(ROOT / "vendor" / "market-data"), remote_path="/app/vendor/market-data")
    .add_local_file(str(ROOT / "tools" / "modal" / "public_data_worker.mjs"), remote_path="/app/public_data_worker.mjs")
    .add_local_file(r"F:\New Eden Sage Data\Static Data\eve-static-data-jsonl.zip", remote_path="/app/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip")
)

PUBLISH_ROOT = Path("/published")
MANIFEST_PATH = PUBLISH_ROOT / "manifest.json"
SCHEDULER_STATUS_PATH = PUBLISH_ROOT / "source-state" / "scheduler-status.json"


def _read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return value if isinstance(value, dict) else None


def _read_manifest() -> dict | None:
    value = _read_json(MANIFEST_PATH)
    if not value or value.get("schemaVersion") != 1 or not value.get("generation"):
        return None
    return value


def _read_scheduler_status() -> dict | None:
    return _read_json(SCHEDULER_STATUS_PATH)


def _parse_utc(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _age_seconds(value: object) -> float | None:
    parsed = _parse_utc(value)
    return None if parsed is None else max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds())


def _scheduler_is_healthy(status: dict | None) -> bool:
    if status is None:
        return False
    age = _age_seconds(status.get("completedAt"))
    return age is not None and age < 15 * 60


@app.function(
    image=image,
    volumes={"/published": published_volume, "/history": history_volume},
    cpu=1.0,
    memory=2048,
    timeout=660,
)
def benchmark_market_pipeline() -> dict:
    """Evaluate public source eligibility, fetch only eligible sources, retain changes, and publish atomically."""
    env = os.environ.copy()
    env["NEW_EDEN_SAGE_RAW_MARKET_ROOT"] = "/published/source-current/Raw Orders"
    env["NEW_EDEN_SAGE_PUBLIC_HISTORY_ROOT"] = "/history"
    env["NEW_EDEN_SAGE_PUBLIC_HISTORY_RETENTION_DAYS"] = str(HISTORY_RETENTION_DAYS)
    env["NEW_EDEN_SAGE_USER_DATA"] = "/tmp/new-eden-sage-user"
    env["NEW_EDEN_SAGE_DISABLE_SHARED_MARKET"] = "1"

    started = time.perf_counter()
    completed = subprocess.run(
        ["node", "--max-old-space-size=1536", "/app/public_data_worker.mjs"],
        cwd="/app",
        env=env,
        capture_output=True,
        text=True,
        timeout=630,
        check=False,
    )
    wall_ms = round((time.perf_counter() - started) * 1000)
    if completed.returncode != 0:
        raise RuntimeError(
            "Sage public data pipeline failed on Modal.\n"
            f"stdout:\n{completed.stdout[-8000:]}\n"
            f"stderr:\n{completed.stderr[-8000:]}"
        )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Sage public data pipeline returned no result JSON.")
    result = json.loads(lines[-1])
    published_volume.commit()
    history_volume.commit()
    result["wallMs"] = wall_ms
    result["modalCpu"] = 1.0
    result["modalMemoryMiB"] = 2048
    return result


@app.function(
    image=image,
    volumes={"/published": published_volume, "/history": history_volume},
    cpu=0.25,
    memory=256,
    timeout=700,
    max_containers=1,
)
@modal.concurrent(max_inputs=1)
def refresh_market_if_stale() -> dict:
    """Compatibility name: this now performs one cache-aware public scheduler evaluation, not a blind stale-market pull."""
    published_volume.reload()
    history_volume.reload()
    previous = _read_manifest()
    result = benchmark_market_pipeline.remote()
    published_volume.reload()
    history_volume.reload()
    current = _read_manifest()
    if current is None and previous is None:
        raise RuntimeError("Public refresh completed without a valid known-good manifest.")
    return {
        "manifest": current or previous,
        "refreshed": bool(result.get("published")),
        "published": bool(result.get("published")),
        "generation": result.get("generation"),
        "marketChanged": bool(result.get("marketChanged")),
        "contractsChanged": bool(result.get("contractsChanged")),
        "publicChanged": bool(result.get("publicChanged")),
        "contractSourceId": result.get("contractSourceId"),
        "contractPendingDetailCount": result.get("contractPendingDetailCount"),
        "contractComputeMs": result.get("contractComputeMs"),
        "scheduler": result.get("scheduler"),
        "history": result.get("history"),
        "refreshWallMs": result.get("wallMs"),
    }


@app.function(image=image, schedule=modal.Period(minutes=5), timeout=720)
def scheduled_market_refresh() -> dict:
    """Producer-only five-minute scheduler. Eligibility is decided per CCP source by the worker."""
    return refresh_market_if_stale.remote()


@app.local_entrypoint()
def main():
    started = time.perf_counter()
    result = refresh_market_if_stale.remote()
    result["clientObservedMs"] = round((time.perf_counter() - started) * 1000)
    print(json.dumps(result, indent=2))


@app.function(
    image=image,
    volumes={"/published": published_volume},
    cpu=0.25,
    memory=256,
    timeout=390,
)
@modal.asgi_app()
def shared_market_web():
    import asyncio

    from fastapi import FastAPI, HTTPException, Request
    globals()["Request"] = Request  # Resolve postponed annotation for FastAPI request injection.
    from fastapi.responses import FileResponse, StreamingResponse

    web = FastAPI(title="New Eden Sage Shared Public Data", docs_url=None, redoc_url=None)

    def reload_state() -> tuple[dict | None, dict | None]:
        published_volume.reload()
        return _read_manifest(), _read_scheduler_status()

    @web.get("/status")
    def status():
        manifest, scheduler = reload_state()
        return {
            "ok": manifest is not None,
            "current": manifest is not None and _scheduler_is_healthy(scheduler),
            "manifestAgeSeconds": _age_seconds(manifest.get("publishedAt")) if manifest else None,
            "schedulerAgeSeconds": _age_seconds(scheduler.get("completedAt")) if scheduler else None,
            "scheduler": scheduler,
            "manifest": manifest,
        }

    @web.get("/latest-complete")
    def latest_complete():
        manifest, _ = reload_state()
        if manifest is None:
            raise HTTPException(status_code=503, detail="No complete shared public generation is available.")
        return {"manifest": manifest}

    @web.get("/ensure-current")
    def ensure_current():
        try:
            return refresh_market_if_stale.remote()
        except Exception as error:
            manifest, scheduler = reload_state()
            if manifest is not None:
                return {
                    "manifest": manifest,
                    "refreshed": False,
                    "published": False,
                    "scheduler": scheduler,
                    "refreshError": str(error),
                }
            raise HTTPException(status_code=503, detail=f"No shared public generation is available: {error}")

    @web.get("/events")
    async def events(request: Request, generation: str = ""):
        async def stream():
            known = generation
            while not await request.is_disconnected():
                manifest, _ = reload_state()
                current = str(manifest.get("generation", "")) if manifest else ""
                if current and current != known:
                    known = current
                    payload = json.dumps({"generation": current, "publishedAt": manifest.get("publishedAt")})
                    yield f"event: public-data-ready\ndata: {payload}\n\n"
                else:
                    yield ": keepalive\n\n"
                await asyncio.sleep(10)
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @web.get("/{artifact_path:path}")
    def artifact(artifact_path: str):
        normalized = artifact_path.lstrip("/")
        parts = normalized.split("/")
        if len(parts) != 3 or parts[0] != "generations" or not parts[1] or not parts[2] or ".." in parts:
            raise HTTPException(status_code=400, detail="Invalid shared public artifact path.")
        generation = parts[1]
        generation_manifest_path = PUBLISH_ROOT / "generations" / generation / "manifest.json"
        generation_manifest = _read_json(generation_manifest_path)
        if not generation_manifest or generation_manifest.get("generation") != generation:
            raise HTTPException(status_code=404, detail="Shared public generation is unavailable.")
        files = generation_manifest.get("files") if isinstance(generation_manifest.get("files"), dict) else {}
        allowed = {
            item.get("path"): item
            for item in files.values()
            if isinstance(item, dict) and isinstance(item.get("path"), str)
        }
        metadata = allowed.get(normalized)
        if metadata is None:
            raise HTTPException(status_code=404, detail="Unknown shared public artifact.")
        target = PUBLISH_ROOT / normalized
        try:
            target.resolve().relative_to(PUBLISH_ROOT.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid artifact path.")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="Shared public artifact is missing.")
        return FileResponse(
            target,
            media_type="application/gzip",
            headers={
                "ETag": str(metadata.get("sha256", "")),
                "X-New-Eden-Sage-Generation": generation,
                "X-New-Eden-Sage-Artifact-Version": str(metadata.get("version", "")),
            },
        )

    return web
