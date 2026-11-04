"""System health for the platform admin tool: a small in-memory collector (requests, server errors since the start)
and the functions that read the databases, the disk and the uploads folder.
The collector lives in the process memory: a restart starts it from zero (the page shows the start time)."""
import os
import platform
import shutil
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import text

MAX_RECENT = 50                     # recent server errors kept
STARTED_AT = datetime.utcnow()
_STARTED_MONO = time.monotonic()

_lock = threading.Lock()
_minutes: dict = {}                 # minute number -> [requests, server errors]
_recent: deque = deque(maxlen=MAX_RECENT)
_totals = {"requests": 0, "errors": 0}


def _minute(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // 60)


def is_counted(path: str) -> bool:
    """Only API calls count; the health page itself (it refreshes by itself) and the static files do not."""
    return path.startswith("/api/") and path.rstrip("/") != "/api/platform/health"


def record(method: str, path: str, status: int, error: Optional[BaseException] = None, now: Optional[float] = None) -> None:
    if not is_counted(path):
        return
    minute = _minute(now)
    with _lock:
        bucket = _minutes.setdefault(minute, [0, 0])
        bucket[0] += 1
        _totals["requests"] += 1
        if status >= 500:
            bucket[1] += 1
            _totals["errors"] += 1
            _recent.appendleft({
                "at": datetime.utcfromtimestamp(now if now is not None else time.time()),
                "method": method[:10],
                "path": path[:200],                               # the path only: the query string may hold private data
                "status": status,
                "error": (type(error).__name__ if error else "")[:80],   # the class name only, never the message
            })
        for old in [m for m in _minutes if m < minute - 60]:
            del _minutes[old]


def reset() -> None:
    with _lock:
        _minutes.clear()
        _recent.clear()
        _totals.update(requests=0, errors=0)


def load(now: Optional[float] = None) -> dict:
    minute = _minute(now)
    with _lock:
        last_minute = sum(b[0] for m, b in _minutes.items() if m >= minute - 1)        # the last full minute + the current one
        errors_hour = sum(b[1] for m, b in _minutes.items() if m > minute - 60)
        return {"requests_last_minute": last_minute, "requests_total": _totals["requests"],
                "errors_last_hour": errors_hour, "errors_total": _totals["errors"]}


def recent_errors() -> list:
    with _lock:
        return list(_recent)


def level_for(value: float, warn: float, critical: float) -> str:
    if value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return "ok"


def worst(levels) -> str:
    order = {"ok": 0, "warning": 1, "critical": 2}
    return max(levels, key=lambda x: order[x], default="ok")


# ------------------------------------------------------------------ server
def server_info(version: str) -> dict:
    now = datetime.utcnow()
    return {"app_version": version, "python_version": platform.python_version(), "started_at": STARTED_AT,
            "uptime_seconds": int(time.monotonic() - _STARTED_MONO), "now": now}


# ------------------------------------------------------------------ databases and disk
def _db_file(engine) -> Optional[Path]:
    name = engine.url.database
    return Path(name).resolve() if name and name != ":memory:" else None


def database_info(name: str, engine) -> dict:
    path = _db_file(engine)
    info = {"name": name, "file": path.name if path else None, "ok": True, "size_bytes": None, "error": None}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:                                   # the page must work even when a database does not
        info["ok"] = False
        info["error"] = type(exc).__name__
    try:
        if path is not None:
            info["size_bytes"] = path.stat().st_size
    except OSError:
        pass
    return info


def folder_size(folder: Path):
    total, files = 0, 0
    try:
        for entry in os.scandir(folder):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat(follow_symlinks=False).st_size
                files += 1
    except OSError:
        pass
    return total, files


def disk_info(where: Path, uploads: Path, warn: int, critical: int) -> dict:
    try:
        usage = shutil.disk_usage(where)
        total, used, free = usage.total, usage.used, usage.free
    except OSError:
        total = used = free = 0
    percent = round(used * 100 / total, 1) if total else 0.0
    size, files = folder_size(uploads)
    return {"total_bytes": total, "used_bytes": used, "free_bytes": free, "used_percent": percent,
            "level": level_for(percent, warn, critical), "uploads_bytes": size, "uploads_files": files}
