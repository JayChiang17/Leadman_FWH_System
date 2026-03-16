# main.py
import io
import os
import platform
import sys
import time as _time
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment before importing modules that read env vars.
load_dotenv()

# Keep Windows console output UTF-8 friendly.
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

from api import api_router
from api.model_inventory import backfill_daily_summary, _load_ram_counters
from api.ws_router import router as ws_router
from core.monitor_db import cleanup_old_logs, init_monitor_db, log_api_request
from core.pg import init_pool, close_pool
from core.scheduler import get_scheduler, start_scheduler, stop_scheduler
from core.ws_manager import ws_manager

app = FastAPI(title="Leadman FWH Backend")

CORS_ORIGINS_ENV = os.getenv(
    "CORS_ORIGINS",
    "https://192.168.10.100:3000,http://192.168.10.100:3000,http://localhost:3000",
)
ALLOWED_ORIGINS = [origin.strip() for origin in CORS_ORIGINS_ENV.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Missing-Count", "X-Found-Count", "X-Total-Count"],
)


_SKIP_LOG_PREFIXES = ("/api/health", "/realtime/", "/ws/", "/sockjs-node/")

_UI_WIDTH = 92


def _line(char: str = "="):
    print(char * _UI_WIDTH)


def _print_center(text: str):
    print(text.center(_UI_WIDTH))


def _print_meta(label: str, value: str):
    print(f"{label:<18}: {value}")


def _print_step(status: str, component: str, detail: str, elapsed_ms: float):
    print(f"[{status:<5}] {component:<14} {elapsed_ms:>8.1f} ms  {detail}")


def _print_banner(stage: str):
    print()
    _line("=")
    _print_center("LEADMAN BACKEND SERVICE")
    _print_center(stage)
    _line("-")
    _print_meta("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    _print_meta("process_id", str(os.getpid()))
    _print_meta("python", platform.python_version())
    _print_meta("cors_origins", str(len(ALLOWED_ORIGINS)))
    _line("-")


def _print_stage_end(status: str, elapsed_ms: float):
    _line("-")
    _print_meta("stage_status", status)
    _print_meta("elapsed", f"{elapsed_ms:.1f} ms")
    _line("=")
    print()


class RequestLoggingMiddleware:
    """Lightweight ASGI request logging without response buffering."""

    def __init__(self, app_):
        self.app = app_

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        if any(path.startswith(p) for p in _SKIP_LOG_PREFIXES):
            return await self.app(scope, receive, send)

        start = _time.time()
        status_code = 0

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
            await send(message)

        await self.app(scope, receive, send_wrapper)

        duration_ms = (_time.time() - start) * 1000

        username = None
        headers = dict(scope.get("headers", []))
        auth = (headers.get(b"authorization", b"")).decode("utf-8", errors="ignore")
        if auth.startswith("Bearer "):
            try:
                from core.security import decode_token

                payload = decode_token(auth[7:])
                username = payload.get("sub")
            except Exception:
                pass

        client = scope.get("client")
        log_api_request(
            method=scope.get("method", ""),
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
            user=username,
            ip=client[0] if client else None,
        )


app.add_middleware(RequestLoggingMiddleware)
app.include_router(api_router)
app.include_router(ws_router)


@app.on_event("startup")
async def startup_event():
    """Initialization on app startup."""
    stage_started = _time.perf_counter()
    _print_banner("STARTUP")

    step_started = _time.perf_counter()
    try:
        init_pool()
        _print_step(
            "OK",
            "pg_pool",
            "PostgreSQL connection pool initialized",
            (_time.perf_counter() - step_started) * 1000,
        )
    except Exception as e:
        _print_step(
            "ERROR",
            "pg_pool",
            str(e),
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        from api.ml import _ensure_ml_schema
        _ensure_ml_schema()
        _print_step(
            "OK",
            "ml_schema",
            "ML schema and tables ensured",
            (_time.perf_counter() - step_started) * 1000,
        )
    except Exception as e:
        _print_step(
            "WARN",
            "ml_schema",
            f"skipped: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        backfill_daily_summary(60)
        _print_step(
            "OK",
            "backfill",
            "model daily_summary backfilled (60 days)",
            (_time.perf_counter() - step_started) * 1000,
        )
    except Exception as e:
        _print_step(
            "WARN",
            "backfill",
            f"skipped: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        _load_ram_counters()
        _print_step(
            "OK",
            "ram_counters",
            "model inventory RAM counters loaded",
            (_time.perf_counter() - step_started) * 1000,
        )
    except Exception as e:
        _print_step(
            "WARN",
            "ram_counters",
            f"skipped: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        init_monitor_db()
        cleanup_old_logs(30)
        _print_step(
            "OK",
            "monitor_db",
            "initialized, retention cleanup=30d",
            (_time.perf_counter() - step_started) * 1000,
        )
    except Exception as e:
        _print_step(
            "ERROR",
            "monitor_db",
            str(e),
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        await ws_manager.start()
        ws_stats = ws_manager.get_stats()
        if ws_stats.get("redis_enabled"):
            detail = f"started, redis=enabled channel={ws_stats.get('redis_channel')}"
        else:
            detail = "started, redis=disabled (local-only mode)"
        _print_step("OK", "ws_manager", detail, (_time.perf_counter() - step_started) * 1000)
    except Exception as e:
        _print_step(
            "ERROR",
            "ws_manager",
            str(e),
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        scheduler_started = start_scheduler(quiet=True)
        scheduler = get_scheduler(emit_init_log=False)
        if scheduler_started:
            detail = (
                f"started, enabled={scheduler.enabled}, "
                f"time={scheduler.report_time}, recipients={len(scheduler.recipients)}"
            )
            _print_step("OK", "scheduler", detail, (_time.perf_counter() - step_started) * 1000)
        else:
            _print_step(
                "INFO",
                "scheduler",
                "skipped on this worker (lock held by leader)",
                (_time.perf_counter() - step_started) * 1000,
            )
    except Exception as e:
        _print_step(
            "WARN",
            "scheduler",
            f"startup failed, running without scheduled email: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    _print_stage_end("READY", (_time.perf_counter() - stage_started) * 1000)


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on app shutdown."""
    stage_started = _time.perf_counter()
    _print_banner("SHUTDOWN")

    step_started = _time.perf_counter()
    try:
        stop_scheduler(quiet=True)
        _print_step("OK", "scheduler", "stopped", (_time.perf_counter() - step_started) * 1000)
    except Exception as e:
        _print_step(
            "WARN",
            "scheduler",
            f"stop failed: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        await ws_manager.stop()
        _print_step("OK", "ws_manager", "stopped", (_time.perf_counter() - step_started) * 1000)
    except Exception as e:
        _print_step(
            "WARN",
            "ws_manager",
            f"stop failed: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    step_started = _time.perf_counter()
    try:
        close_pool()
        _print_step("OK", "pg_pool", "closed", (_time.perf_counter() - step_started) * 1000)
    except Exception as e:
        _print_step(
            "WARN",
            "pg_pool",
            f"close failed: {e}",
            (_time.perf_counter() - step_started) * 1000,
        )

    _print_stage_end("STOPPED", (_time.perf_counter() - stage_started) * 1000)
