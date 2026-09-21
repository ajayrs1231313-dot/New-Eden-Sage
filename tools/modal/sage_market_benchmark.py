from __future__ import annotations

import json
import hashlib
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import modal

_HERE = Path(__file__).resolve()
ROOT = _HERE.parents[2] if len(_HERE.parents) > 2 and (_HERE.parents[2] / "package.json").exists() else Path("/app")
PUBLISHED_VOLUME_NAME = "new-eden-sage-market-trial"
HISTORY_VOLUME_NAME = "new-eden-sage-public-history"
METRICS_VOLUME_NAME = "new-eden-sage-product-metrics"
METRICS_PRESENCE_DICT_NAME = "new-eden-sage-product-presence"
NOTIFICATION_RULES_DICT_NAME = "new-eden-sage-notification-rules"
NOTIFICATION_USER_RULES_DICT_NAME = "new-eden-sage-notification-user-rules"
NOTIFICATION_STATES_DICT_NAME = "new-eden-sage-notification-states"
NOTIFICATION_EVENTS_DICT_NAME = "new-eden-sage-notification-events"
NOTIFICATION_USER_EVENTS_DICT_NAME = "new-eden-sage-notification-user-events"
NOTIFICATION_ACKS_DICT_NAME = "new-eden-sage-notification-acks"
REFRESH_GUARD_DICT_NAME = "new-eden-sage-public-refresh-guard"
REFRESH_GUARD_KEY = "public-refresh"
REFRESH_GUARD_LEASE_SECONDS = 15 * 60
METRICS_PRESENCE_WINDOW_SECONDS = 75
NOTIFICATION_MAX_EVENTS_PER_USER = 250
NOTIFICATION_MAX_RULES_PER_USER = 500
SAGE_ONLINE_IDENTITY_URL = "https://new-eden-sage-online.ajayrs2512.workers.dev/v1/identity"
SAGE_IDENTITY_CACHE_SECONDS = 300
_sage_identity_cache: dict[str, tuple[float, dict]] = {}
HISTORY_RETENTION_DAYS = int(os.environ.get("NEW_EDEN_SAGE_PUBLIC_HISTORY_RETENTION_DAYS", "120"))

app = modal.App("new-eden-sage-market-benchmark")
published_volume = modal.Volume.from_name(PUBLISHED_VOLUME_NAME, create_if_missing=True)
history_volume = modal.Volume.from_name(HISTORY_VOLUME_NAME, create_if_missing=True)
metrics_volume = modal.Volume.from_name(METRICS_VOLUME_NAME, create_if_missing=True)
metrics_presence = modal.Dict.from_name(METRICS_PRESENCE_DICT_NAME, create_if_missing=True)
notification_rules = modal.Dict.from_name(NOTIFICATION_RULES_DICT_NAME, create_if_missing=True)
notification_user_rules = modal.Dict.from_name(NOTIFICATION_USER_RULES_DICT_NAME, create_if_missing=True)
notification_states = modal.Dict.from_name(NOTIFICATION_STATES_DICT_NAME, create_if_missing=True)
notification_events = modal.Dict.from_name(NOTIFICATION_EVENTS_DICT_NAME, create_if_missing=True)
notification_user_events = modal.Dict.from_name(NOTIFICATION_USER_EVENTS_DICT_NAME, create_if_missing=True)
notification_acks = modal.Dict.from_name(NOTIFICATION_ACKS_DICT_NAME, create_if_missing=True)
refresh_guard = modal.Dict.from_name(REFRESH_GUARD_DICT_NAME, create_if_missing=True)

image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .pip_install("fastapi>=0.115,<1")
    .run_commands("mkdir -p /app && cd /app && npm init -y >/dev/null 2>&1 && npm install adm-zip@0.6.0 >/dev/null 2>&1")
    .add_local_dir(str(ROOT / "dist-electron"), remote_path="/app/dist-electron")
    .add_local_dir(str(ROOT / "vendor" / "market-data"), remote_path="/app/vendor/market-data")
    .add_local_file(str(ROOT / "tools" / "modal" / "public_data_worker.mjs"), remote_path="/app/public_data_worker.mjs")
    .add_local_file(str(ROOT / "tools" / "modal" / "notification_engine.mjs"), remote_path="/app/notification_engine.mjs")
    .add_local_file(str(ROOT / "tools" / "modal" / "blueprint_contract_history.py"), remote_path="/app/blueprint_contract_history.py")
    .add_local_file(r"F:\New Eden Sage Data\Static Data\eve-static-data-jsonl.zip", remote_path="/app/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip")
)

PUBLISH_ROOT = Path("/published")
MANIFEST_PATH = PUBLISH_ROOT / "manifest.json"
SCHEDULER_STATUS_PATH = PUBLISH_ROOT / "source-state" / "scheduler-status.json"
NOTIFICATION_STATUS_PATH = PUBLISH_ROOT / "source-state" / "notification-status.json"


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


def _clean_notification_value(value: object, depth: int = 0) -> object:
    if depth > 3:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value.replace("\x00", "")[:500]
    if isinstance(value, list):
        return [_clean_notification_value(item, depth + 1) for item in value[:40]]
    if isinstance(value, dict):
        cleaned: dict[str, object] = {}
        for key, item in list(value.items())[:40]:
            safe_key = str(key).replace("\x00", "")[:80]
            if safe_key:
                cleaned[safe_key] = _clean_notification_value(item, depth + 1)
        return cleaned
    return str(value)[:200]


def _positive_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _finite_number(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def _normalise_notification_rule(payload: object, sage_id: str, request_id: str, existing: dict | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Notification rule body must be an object.")
    kind = str(payload.get("kind") or (existing or {}).get("kind") or "").strip().lower()[:120]
    if not kind or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789._-" for ch in kind):
        raise ValueError("Notification kind is invalid.")

    target_source = payload.get("target") if "target" in payload else (existing or {}).get("target", {})
    condition_source = payload.get("condition") if "condition" in payload else (existing or {}).get("condition", {})
    metadata_source = payload.get("metadata") if "metadata" in payload else (existing or {}).get("metadata", {})
    target = _clean_notification_value(target_source if isinstance(target_source, dict) else {})
    condition = _clean_notification_value(condition_source if isinstance(condition_source, dict) else {})
    metadata = _clean_notification_value(metadata_source if isinstance(metadata_source, dict) else {})
    if not isinstance(target, dict) or not isinstance(condition, dict) or not isinstance(metadata, dict):
        raise ValueError("Notification target, condition and metadata must be objects.")

    if kind.startswith("market."):
        type_id = _positive_int(target.get("typeId"))
        region_id = _positive_int(target.get("regionId"))
        if type_id is None or region_id is None:
            raise ValueError("Market notifications require target.typeId and target.regionId.")
        target["typeId"] = type_id
        target["regionId"] = region_id
        if target.get("locationId") is not None:
            location_id = _positive_int(target.get("locationId"))
            if location_id is None:
                raise ValueError("target.locationId must be a positive integer.")
            target["locationId"] = location_id
        if target.get("orderId") is not None:
            order_id = _positive_int(target.get("orderId"))
            if order_id is None:
                raise ValueError("target.orderId must be a positive integer.")
            target["orderId"] = order_id
        if target.get("ownOrderId") is not None:
            own_order_id = _positive_int(target.get("ownOrderId"))
            if own_order_id is None:
                raise ValueError("target.ownOrderId must be a positive integer.")
            target["ownOrderId"] = own_order_id

    if kind in ("market.price_below", "market.price_above"):
        threshold = _finite_number(condition.get("threshold"))
        if threshold is None or threshold < 0:
            raise ValueError("Price notifications require a non-negative condition.threshold.")
        condition["threshold"] = threshold
        min_volume = _positive_int(condition.get("minVolume", 1))
        if min_volume is None:
            raise ValueError("Price notifications require condition.minVolume to be a positive integer.")
        condition["minVolume"] = min_volume

    if kind == "market.custom_condition":
        allowed_ops = ("any", "lt", "lte", "gt", "gte", "eq")
        price_operator = str(condition.get("priceOperator") or "any").lower()
        volume_operator = str(condition.get("volumeOperator") or "any").lower()
        if price_operator not in allowed_ops:
            raise ValueError("condition.priceOperator is invalid.")
        if volume_operator not in allowed_ops:
            raise ValueError("condition.volumeOperator is invalid.")
        if price_operator == "any" and volume_operator == "any":
            raise ValueError("A custom market notification needs at least one condition.")
        condition["priceOperator"] = price_operator
        condition["volumeOperator"] = volume_operator
        if price_operator != "any":
            price_value = _finite_number(condition.get("priceValue"))
            if price_value is None or price_value < 0:
                raise ValueError("condition.priceValue must be a non-negative number.")
            condition["priceValue"] = price_value
        else:
            condition.pop("priceValue", None)
        if volume_operator != "any":
            volume_raw = _finite_number(condition.get("volumeValue"))
            if volume_raw is None or volume_raw < 0 or int(volume_raw) != volume_raw:
                raise ValueError("condition.volumeValue must be a non-negative integer.")
            condition["volumeValue"] = int(volume_raw)
        else:
            condition.pop("volumeValue", None)

    if kind == "market.order_undercut":
        order_price = _finite_number(condition.get("orderPrice", target.get("orderPrice")))
        if order_price is None or order_price < 0:
            raise ValueError("Undercut notifications require condition.orderPrice.")
        condition["orderPrice"] = order_price

    if kind == "market.available" and condition.get("maxPrice") is not None:
        max_price = _finite_number(condition.get("maxPrice"))
        if max_price is None or max_price < 0:
            raise ValueError("condition.maxPrice must be non-negative.")
        condition["maxPrice"] = max_price

    if kind.startswith("contract."):
        contract_id = _positive_int(target.get("contractId"))
        if contract_id is None:
            raise ValueError("Contract notifications require target.contractId.")
        target["contractId"] = contract_id

    side = str(condition.get("side") or target.get("side") or "sell").lower()
    if side not in ("buy", "sell"):
        raise ValueError("Notification side must be buy or sell.")
    if kind.startswith("market."):
        condition["side"] = side

    default_repeat = "change" if kind == "contract.auction_bid" else "edge"
    repeat_mode = str(payload.get("repeatMode") or (existing or {}).get("repeatMode") or default_repeat).lower()
    if repeat_mode not in ("edge", "change", "once", "always"):
        raise ValueError("repeatMode must be edge, change, once or always.")

    now = datetime.now(timezone.utc).isoformat()
    created_at = str((existing or {}).get("createdAt") or now)
    label = str(payload.get("label") if "label" in payload else (existing or {}).get("label", "")).replace("\x00", "")[:160]
    enabled = bool(payload.get("enabled")) if "enabled" in payload else bool((existing or {}).get("enabled", True))
    return {
        "schemaVersion": 1,
        "requestId": request_id,
        "version": max(1, int((existing or {}).get("version") or 0) + 1),
        "sageId": sage_id,
        "kind": kind,
        "label": label,
        "enabled": enabled,
        "repeatMode": repeat_mode,
        "target": target,
        "condition": condition,
        "metadata": metadata,
        "createdAt": created_at,
        "updatedAt": now,
    }


def _verify_sage_session(authorization: str) -> dict:
    authorization = str(authorization or "").strip()
    if not authorization.lower().startswith("bearer "):
        raise PermissionError("A Sage session is required.")

    token = authorization.split(None, 1)[1].strip()
    cache_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    cached = _sage_identity_cache.get(cache_key)
    now_mono = time.monotonic()
    if cached and cached[0] > now_mono:
        return dict(cached[1])
    if cached:
        _sage_identity_cache.pop(cache_key, None)

    verifier = r"""
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
fetch(input.url, {
  headers: {
    Authorization: "Bearer " + input.token,
    Accept: "application/json",
    "User-Agent": "NewEdenSage-Notifications/1",
  },
}).then(async (response) => {
  const text = await response.text();
  process.stdout.write(JSON.stringify({ status: response.status, text }));
}).catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(2);
});
"""
    try:
        result = subprocess.run(
            ["node", "-e", verifier],
            input=json.dumps({"url": SAGE_ONLINE_IDENTITY_URL, "token": token}),
            text=True,
            capture_output=True,
            timeout=12,
            check=False,
        )
    except Exception as error:
        raise RuntimeError(f"Sage identity service is unavailable: {error}") from error

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "identity verifier failed").strip()
        raise RuntimeError(f"Sage identity service is unavailable: {detail[:500]}")
    try:
        envelope = json.loads(result.stdout)
        status = int(envelope.get("status") or 0)
        raw = str(envelope.get("text") or "")
        payload = json.loads(raw) if raw else {}
    except Exception as error:
        raise RuntimeError("Sage identity service returned an unreadable response.") from error

    if status in (401, 403):
        raise PermissionError("Sage session rejected or expired.")
    if status < 200 or status >= 300:
        raise RuntimeError(f"Sage identity service returned HTTP {status}.")

    account = payload.get("account") if isinstance(payload, dict) else None
    if not isinstance(account, dict) or not account.get("id"):
        raise PermissionError("Sage identity response did not contain an account.")
    identity = {
        "sageId": str(account["id"]),
        "primaryCharacterId": _positive_int(account.get("primary_eve_character_id")),
    }
    _sage_identity_cache[cache_key] = (now_mono + SAGE_IDENTITY_CACHE_SECONDS, identity)
    if len(_sage_identity_cache) > 2048:
        expired = [key for key, value in _sage_identity_cache.items() if value[0] <= now_mono]
        for key in expired[:1024]:
            _sage_identity_cache.pop(key, None)
    return dict(identity)

def _write_notification_input(path: Path) -> int:
    active_rules: list[dict] = []
    active_ids: set[str] = set()
    for request_id, value in list(notification_rules.items()):
        if isinstance(value, dict) and value.get("enabled", True):
            active_rules.append(value)
            active_ids.add(str(request_id))
    states: dict[str, dict] = {}
    for request_id in active_ids:
        value = notification_states.get(request_id)
        if isinstance(value, dict):
            states[request_id] = value
    path.write_text(json.dumps({"schemaVersion": 1, "rules": active_rules, "states": states}, separators=(",", ":")), encoding="utf-8")
    return len(active_rules)


def _persist_notification_result(result: dict | None) -> dict:
    if not isinstance(result, dict):
        return {"evaluated": 0, "triggered": 0, "delivered": 0, "errors": 0}
    state_updates = result.get("stateUpdates")
    if isinstance(state_updates, list):
        for state in state_updates:
            if not isinstance(state, dict) or not state.get("requestId"):
                continue
            request_id = str(state["requestId"])
            current_rule = notification_rules.get(request_id)
            if not isinstance(current_rule, dict):
                continue
            if int(current_rule.get("version") or 1) != int(state.get("ruleVersion") or 1):
                continue
            notification_states.put(request_id, state)

    grouped: dict[str, list[str]] = {}
    delivered = 0
    events = result.get("events")
    if isinstance(events, list):
        for event in events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("eventId") or "")
            sage_id = str(event.get("sageId") or "")
            request_id = str(event.get("requestId") or "")
            if not event_id or not sage_id or not request_id:
                continue
            rule = notification_rules.get(request_id)
            if not isinstance(rule, dict) or str(rule.get("sageId") or "") != sage_id:
                continue
            if int(rule.get("version") or 1) != int(event.get("ruleVersion") or 1):
                continue
            notification_events.put(event_id, event)
            grouped.setdefault(sage_id, []).append(event_id)
            delivered += 1

    for sage_id, new_ids in grouped.items():
        existing = notification_user_events.get(sage_id)
        current = [str(item) for item in existing] if isinstance(existing, list) else []
        all_ids = current + new_ids
        combined = all_ids[-NOTIFICATION_MAX_EVENTS_PER_USER:]
        retained = set(combined)
        for expired_event_id in all_ids:
            if expired_event_id in retained:
                continue
            notification_events.pop(expired_event_id, None)
            notification_acks.pop(f"{sage_id}:{expired_event_id}", None)
        notification_user_events.put(sage_id, combined)

    return {
        "evaluated": int(result.get("evaluated") or 0),
        "triggered": int(result.get("triggered") or 0),
        "delivered": delivered,
        "errors": len(result.get("errors") or []) if isinstance(result.get("errors"), list) else 0,
        "rawRegionsRead": int(result.get("rawRegionsRead") or 0),
        "marketBooksBuilt": int(result.get("marketBooksBuilt") or 0),
        "marketQuoteKeysEvaluated": int(result.get("marketQuoteKeysEvaluated") or 0),
        "contractBidSourcesRead": int(result.get("contractBidSourcesRead") or 0),
        "skippedUnchangedMarket": int(result.get("skippedUnchangedMarket") or 0),
    }


@app.function(
    image=image,
    volumes={"/published": published_volume, "/history": history_volume},
    cpu=1.0,
    memory=2048,
    timeout=660,
)
def benchmark_market_pipeline() -> dict:
    """Evaluate public source eligibility, fetch only eligible sources, retain changes, and publish atomically."""
    notification_input_path = Path("/tmp/new-eden-sage-notifications-input.json")
    notification_result_path = Path("/tmp/new-eden-sage-notifications-result.json")
    notification_rule_count = _write_notification_input(notification_input_path)
    try:
        notification_result_path.unlink(missing_ok=True)
    except OSError:
        pass

    env = os.environ.copy()
    env["NEW_EDEN_SAGE_RAW_MARKET_ROOT"] = "/published/source-current/Raw Orders"
    env["NEW_EDEN_SAGE_PUBLIC_HISTORY_ROOT"] = "/history"
    env["NEW_EDEN_SAGE_PUBLIC_HISTORY_RETENTION_DAYS"] = str(HISTORY_RETENTION_DAYS)
    env["NEW_EDEN_SAGE_USER_DATA"] = "/tmp/new-eden-sage-user"
    env["NEW_EDEN_SAGE_DISABLE_SHARED_MARKET"] = "1"
    env["NEW_EDEN_SAGE_NOTIFICATION_INPUT_FILE"] = str(notification_input_path)
    env["NEW_EDEN_SAGE_NOTIFICATION_RESULT_FILE"] = str(notification_result_path)

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
    notification_result = _read_json(notification_result_path)
    notification_delivery = _persist_notification_result(notification_result)
    result["notifications"] = {
        "activeRules": notification_rule_count,
        **notification_delivery,
        "evaluatedAt": notification_result.get("evaluatedAt") if isinstance(notification_result, dict) else None,
    }
    notification_completed_at = datetime.now(timezone.utc).isoformat()
    NOTIFICATION_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    notification_status_tmp = NOTIFICATION_STATUS_PATH.with_suffix(".json.tmp")
    notification_status_tmp.write_text(
        json.dumps({**result["notifications"], "completedAt": notification_completed_at}, separators=(",", ":")),
        encoding="utf-8",
    )
    notification_status_tmp.replace(NOTIFICATION_STATUS_PATH)
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
    max_containers=4,
)
@modal.concurrent(max_inputs=1)
def refresh_market_if_stale() -> dict:
    """Run one cache-aware public scheduler evaluation, skipping immediately when another refresh owns the lease."""
    published_volume.reload()
    history_volume.reload()
    previous = _read_manifest()

    now = time.time()
    existing = refresh_guard.get(REFRESH_GUARD_KEY)
    if isinstance(existing, dict) and float(existing.get("expiresAt", 0) or 0) <= now:
        refresh_guard.pop(REFRESH_GUARD_KEY, None)

    lease_token = f"{time.time_ns()}-{os.getpid()}"
    lease = {
        "token": lease_token,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "expiresAt": now + REFRESH_GUARD_LEASE_SECONDS,
    }
    if not refresh_guard.put(REFRESH_GUARD_KEY, lease, skip_if_exists=True):
        active = refresh_guard.get(REFRESH_GUARD_KEY)
        if previous is None:
            raise RuntimeError("Public refresh already in progress and no known-good manifest is available yet.")
        return {
            "manifest": previous,
            "refreshed": False,
            "published": False,
            "generation": previous.get("generation"),
            "skipped": True,
            "skipReason": "refresh-in-progress",
            "activeRefresh": active,
            "scheduler": _read_scheduler_status(),
        }

    try:
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
    finally:
        active = refresh_guard.get(REFRESH_GUARD_KEY)
        if isinstance(active, dict) and active.get("token") == lease_token:
            refresh_guard.pop(REFRESH_GUARD_KEY, None)


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
    volumes={"/history": history_volume},
    cpu=1.0,
    memory=1024,
    timeout=360,
    max_containers=2,
)
def query_blueprint_contract_history(payload: dict) -> dict:
    """Query compact blueprint valuation evidence derived from retained public-contract history."""
    import importlib.util
    history_volume.reload()
    module_path = "/app/blueprint_contract_history.py"
    spec = importlib.util.spec_from_file_location("blueprint_contract_history_runtime", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load blueprint contract-history module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.query_blueprint_valuations("/history", payload, retention_days=HISTORY_RETENTION_DAYS)
    history_volume.commit()
    return result


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

    async def authenticated_sage(request: Request) -> dict:
        try:
            return await asyncio.to_thread(_verify_sage_session, request.headers.get("Authorization", ""))
        except PermissionError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def own_notification_rule(request_id: str, sage_id: str) -> dict | None:
        rule = notification_rules.get(request_id)
        if not isinstance(rule, dict) or str(rule.get("sageId") or "") != sage_id:
            return None
        return rule

    def owned_notification_rule_ids(sage_id: str) -> list[str]:
        saved = notification_user_rules.get(sage_id)
        if isinstance(saved, list):
            return [str(value) for value in saved if value]
        recovered = [
            str(request_id)
            for request_id, value in list(notification_rules.items())
            if isinstance(value, dict) and str(value.get("sageId") or "") == sage_id
        ]
        notification_user_rules.put(sage_id, recovered)
        return recovered

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

    @web.post("/contract-history/blueprint-valuations")
    def blueprint_contract_valuations(payload: dict):
        queries = payload.get("queries") if isinstance(payload, dict) else None
        if not isinstance(queries, list) or not queries:
            raise HTTPException(status_code=400, detail="queries must be a non-empty array")
        if len(queries) > 250:
            raise HTTPException(status_code=400, detail="at most 250 blueprint queries are allowed per request")
        try:
            return query_blueprint_contract_history.remote(payload)
        except Exception as error:
            raise HTTPException(status_code=503, detail=f"Blueprint contract-history query failed: {error}") from error

    @web.get("/v1/notifications/capabilities")
    def notification_capabilities():
        return {
            "schemaVersion": 1,
            "delivery": "per-sage-account",
            "evaluatedOnEveryCrunch": True,
            "builtInKinds": [
                "market.price_below",
                "market.price_above",
                "market.available",
                "market.custom_condition",
                "market.order_undercut",
                "contract.auction_bid",
            ],
            "repeatModes": ["edge", "change", "once", "always"],
        }

    @web.post("/v1/notifications/rules")
    async def create_notification_rule(request: Request):
        identity = await authenticated_sage(request)
        try:
            payload = await request.json()
        except Exception as error:
            raise HTTPException(status_code=400, detail="Body must be valid JSON.") from error
        owned_rule_ids = owned_notification_rule_ids(identity["sageId"])
        if len(owned_rule_ids) >= NOTIFICATION_MAX_RULES_PER_USER:
            raise HTTPException(status_code=429, detail=f"Notification rule limit reached ({NOTIFICATION_MAX_RULES_PER_USER}).")
        request_id = f"notify_{uuid.uuid4()}"
        try:
            rule = _normalise_notification_rule(payload, identity["sageId"], request_id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        notification_rules.put(request_id, rule)
        notification_states.pop(request_id, None)
        notification_user_rules.put(identity["sageId"], owned_rule_ids + [request_id])
        return {"rule": rule}

    @web.get("/v1/notifications/rules")
    async def list_notification_rules(request: Request):
        identity = await authenticated_sage(request)
        sage_id = identity["sageId"]
        rules: list[dict] = []
        for request_id in owned_notification_rule_ids(sage_id):
            value = notification_rules.get(request_id)
            if not isinstance(value, dict) or str(value.get("sageId") or "") != sage_id:
                continue
            row = dict(value)
            state = notification_states.get(request_id)
            row["state"] = state if isinstance(state, dict) else None
            rules.append(row)
        rules.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
        return {"rules": rules}

    @web.put("/v1/notifications/rules/{request_id}")
    async def update_notification_rule(request_id: str, request: Request):
        identity = await authenticated_sage(request)
        existing = own_notification_rule(request_id, identity["sageId"])
        if existing is None:
            raise HTTPException(status_code=404, detail="Notification rule not found.")
        try:
            payload = await request.json()
        except Exception as error:
            raise HTTPException(status_code=400, detail="Body must be valid JSON.") from error
        try:
            rule = _normalise_notification_rule(payload, identity["sageId"], request_id, existing)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        notification_rules.put(request_id, rule)
        notification_states.pop(request_id, None)
        return {"rule": rule}

    @web.delete("/v1/notifications/rules/{request_id}")
    async def delete_notification_rule(request_id: str, request: Request):
        identity = await authenticated_sage(request)
        if own_notification_rule(request_id, identity["sageId"]) is None:
            raise HTTPException(status_code=404, detail="Notification rule not found.")
        notification_rules.pop(request_id, None)
        notification_states.pop(request_id, None)
        notification_user_rules.put(
            identity["sageId"],
            [value for value in owned_notification_rule_ids(identity["sageId"]) if value != request_id],
        )
        return {"deleted": True, "requestId": request_id}

    @web.get("/v1/notifications/inbox")
    async def notification_inbox(request: Request, limit: int = 50, include_acknowledged: bool = False):
        identity = await authenticated_sage(request)
        sage_id = identity["sageId"]
        limit = max(1, min(100, int(limit)))
        saved_ids = notification_user_events.get(sage_id)
        event_ids = [str(value) for value in saved_ids] if isinstance(saved_ids, list) else []
        rows: list[dict] = []
        for event_id in reversed(event_ids):
            event = notification_events.get(event_id)
            if not isinstance(event, dict) or str(event.get("sageId") or "") != sage_id:
                continue
            ack_key = f"{sage_id}:{event_id}"
            acknowledged = notification_acks.get(ack_key) is not None
            if acknowledged and not include_acknowledged:
                continue
            row = dict(event)
            row["acknowledged"] = acknowledged
            rows.append(row)
            if len(rows) >= limit:
                break
        return {"events": rows, "unread": sum(1 for event_id in event_ids if notification_acks.get(f"{sage_id}:{event_id}") is None)}

    @web.post("/v1/notifications/inbox/{event_id}/ack")
    async def acknowledge_notification(event_id: str, request: Request):
        identity = await authenticated_sage(request)
        sage_id = identity["sageId"]
        event = notification_events.get(event_id)
        if not isinstance(event, dict) or str(event.get("sageId") or "") != sage_id:
            raise HTTPException(status_code=404, detail="Notification not found.")
        acknowledged_at = datetime.now(timezone.utc).isoformat()
        notification_acks.put(f"{sage_id}:{event_id}", {
            "sageId": sage_id,
            "eventId": event_id,
            "acknowledgedAt": acknowledged_at,
        })
        return {"acknowledged": True, "eventId": event_id, "acknowledgedAt": acknowledged_at}

    @web.get("/events")
    async def events(request: Request, generation: str = ""):
        async def stream():
            known_generation = generation
            known_notification_pass = ""
            while not await request.is_disconnected():
                manifest, scheduler = reload_state()
                emitted = False
                current_generation = str(manifest.get("generation", "")) if manifest else ""
                if current_generation and current_generation != known_generation:
                    known_generation = current_generation
                    payload = json.dumps({"generation": current_generation, "publishedAt": manifest.get("publishedAt")})
                    yield f"event: public-data-ready\ndata: {payload}\n\n"
                    emitted = True

                notification_status = _read_json(NOTIFICATION_STATUS_PATH)
                completed_at = str(notification_status.get("completedAt", "")) if notification_status else ""
                if completed_at:
                    if known_notification_pass and completed_at != known_notification_pass:
                        payload = json.dumps({
                            "evaluatedAt": completed_at,
                            "notifications": notification_status if isinstance(notification_status, dict) else {},
                        })
                        yield f"event: notification-check\ndata: {payload}\n\n"
                        emitted = True
                    known_notification_pass = completed_at

                if not emitted:
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

@app.function(
    image=image,
    volumes={"/metrics": metrics_volume},
    cpu=0.25,
    memory=256,
    timeout=120,
    max_containers=1,
)
@modal.concurrent(max_inputs=64)
@modal.asgi_app()
def metrics_web():
    """Receive privacy-bounded product analytics and expose aggregate live presence."""

    import threading

    from fastapi import FastAPI, HTTPException, Request

    globals()["Request"] = Request
    web = FastAPI(title="New Eden Sage Product Metrics", docs_url=None, redoc_url=None)
    write_lock = threading.Lock()
    metrics_root = Path("/metrics")
    events_root = metrics_root / "events"

    def clean_string(value: object, limit: int) -> str:
        if not isinstance(value, str):
            return ""
        return value.replace("\x00", "")[:limit]

    def clean_value(value: object, depth: int = 0) -> object:
        if depth > 3:
            return None
        if value is None or isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, str):
            return clean_string(value, 500)
        if isinstance(value, list):
            return [clean_value(item, depth + 1) for item in value[:40]]
        if isinstance(value, dict):
            result: dict[str, object] = {}
            for key, item in list(value.items())[:50]:
                safe_key = clean_string(key, 80)
                if safe_key:
                    result[safe_key] = clean_value(item, depth + 1)
            return result
        return clean_string(str(value), 200)

    def prune_and_count_presence(now_epoch: float) -> int:
        connected = 0
        stale: list[str] = []
        for install_id, state in list(metrics_presence.items()):
            if not isinstance(state, dict):
                stale.append(str(install_id))
                continue
            last_seen = float(state.get("lastSeenEpoch", 0) or 0)
            if now_epoch - last_seen <= METRICS_PRESENCE_WINDOW_SECONDS:
                connected += 1
            else:
                stale.append(str(install_id))
        for install_id in stale:
            metrics_presence.pop(install_id, None)
        return connected

    @web.get("/status")
    def status():
        now_epoch = time.time()
        return {
            "ok": True,
            "connected": prune_and_count_presence(now_epoch),
            "presenceWindowSeconds": METRICS_PRESENCE_WINDOW_SECONDS,
            "storage": f"modal-volume:{METRICS_VOLUME_NAME}",
        }

    @web.get("/v1/presence/count")
    def presence_count():
        now_epoch = time.time()
        return {
            "connected": prune_and_count_presence(now_epoch),
            "windowSeconds": METRICS_PRESENCE_WINDOW_SECONDS,
            "asOf": datetime.now(timezone.utc).isoformat(),
        }

    @web.post("/v1/events")
    async def ingest_events(request: Request):
        try:
            payload = await request.json()
        except Exception as error:
            raise HTTPException(status_code=400, detail="Body must be valid JSON.") from error
        events = payload.get("events") if isinstance(payload, dict) else None
        if not isinstance(events, list):
            raise HTTPException(status_code=400, detail="events must be an array.")
        if len(events) > 200:
            raise HTTPException(status_code=400, detail="At most 200 events are accepted per batch.")

        server_now = datetime.now(timezone.utc)
        server_at = server_now.isoformat()
        accepted: list[dict[str, object]] = []
        presence_updates: dict[str, dict[str, object]] = {}
        for event in events:
            if not isinstance(event, dict):
                continue
            event_type = clean_string(event.get("type"), 80)
            install_id = clean_string(event.get("installId"), 96)
            session_id = clean_string(event.get("sessionId"), 96)
            if not event_type or not install_id or not session_id:
                continue
            row: dict[str, object] = {
                "serverAt": server_at,
                "type": event_type,
                "at": clean_string(event.get("at"), 64) or server_at,
                "installId": install_id,
                "sessionId": session_id,
                "page": clean_string(event.get("page"), 180),
                "appVersion": clean_string(event.get("appVersion"), 40),
                "active": bool(event.get("active")),
                "data": clean_value(event.get("data") if isinstance(event.get("data"), dict) else {}),
            }
            accepted.append(row)
            presence_updates[install_id] = {
                "lastSeenEpoch": server_now.timestamp(),
                "lastSeenAt": server_at,
                "sessionId": session_id,
                "appVersion": row["appVersion"],
                "page": row["page"],
                "active": row["active"],
            }

        if accepted:
            day_path = events_root / f"{server_now.date().isoformat()}.jsonl"
            with write_lock:
                metrics_volume.reload()
                day_path.parent.mkdir(parents=True, exist_ok=True)
                with day_path.open("a", encoding="utf-8", newline="\n") as handle:
                    for row in accepted:
                        handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                metrics_volume.commit()
            for install_id, state in presence_updates.items():
                metrics_presence.put(install_id, state)

        return {
            "accepted": len(accepted),
            "connected": prune_and_count_presence(server_now.timestamp()),
            "storedAt": f"/metrics/events/{server_now.date().isoformat()}.jsonl",
        }

    return web
