"""Platform admin logic: audit log, root account from .env, login lock."""
import json
import re
from datetime import datetime, timedelta
from typing import Optional

from app.auth import get_password_hash, verify_password
from app.config import settings
from app.platform_db import PlatformSession
from app import platform_models as pm

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,39}$")
NO_ADMINS_NOTICE = ("There are no platform admins here. Set PLATFORM_ROOT_USERNAME and "
                    "PLATFORM_ROOT_PASSWORD in .env and restart the application.")


def client_ip(request) -> Optional[str]:
    return request.client.host if request.client else None


def norm_username(value: Optional[str]) -> str:
    return (value or "").strip().lower()[:60]


# ------------------------------------------------------------------ audit log
def write_audit(db, action: str, actor=None, actor_name: Optional[str] = None, target_type: Optional[str] = None,
                target_id: Optional[int] = None, target_name: Optional[str] = None,
                details: Optional[dict] = None, ip: Optional[str] = None) -> None:
    """Adds one row. The caller commits (so the log row and the change are saved together)."""
    db.add(pm.PlatformAuditLog(
        actor_id=actor.id if actor is not None else None,
        actor_name=actor.username if actor is not None else actor_name,
        action=action, target_type=target_type, target_id=target_id, target_name=target_name,
        details=json.dumps(details, ensure_ascii=False) if details else None,
        ip=ip,
    ))


# ------------------------------------------------------------------ login lock
def lock_state(db, username: str) -> int:
    """Minutes left of the lock (rounded up), 0 = not locked."""
    row = db.query(pm.PlatformLoginLock).filter(pm.PlatformLoginLock.username == username).first()
    if row is None or row.locked_until is None:
        return 0
    left = (row.locked_until - datetime.utcnow()).total_seconds()
    return int(left // 60) + 1 if left > 0 else 0


def register_failure(db, username: str) -> bool:
    """Counts a failed login. Returns True when this failure started a lock."""
    now = datetime.utcnow()
    # old counters of names that never got locked are not kept
    db.query(pm.PlatformLoginLock).filter(
        pm.PlatformLoginLock.locked_until.is_(None),
        pm.PlatformLoginLock.updated_at < now - timedelta(days=1),
    ).delete(synchronize_session=False)
    row = db.query(pm.PlatformLoginLock).filter(pm.PlatformLoginLock.username == username).first()
    if row is None:
        row = pm.PlatformLoginLock(username=username, failed_count=0)
        db.add(row)
    if row.locked_until is not None and row.locked_until <= now:      # an old lock ended: start again
        row.locked_until = None
        row.failed_count = 0
    row.failed_count += 1
    row.updated_at = now
    if row.failed_count >= settings.PLATFORM_MAX_FAILED_LOGINS:
        row.locked_until = now + timedelta(minutes=settings.PLATFORM_LOCK_MINUTES)
        row.failed_count = 0
        return True
    return False


def clear_failures(db, username: str) -> None:
    db.query(pm.PlatformLoginLock).filter(pm.PlatformLoginLock.username == username).delete(
        synchronize_session=False)


# ------------------------------------------------------------------ root account (.env)
def sync_root() -> dict:
    """Runs at start. PLATFORM_ROOT_USERNAME / PLATFORM_ROOT_PASSWORD (.env) create or update the root
    account. If they are not set, the root account (if it exists) is switched off, and the application
    still starts. Returns a small status dict (also used by the tests)."""
    db = PlatformSession()
    try:
        username = norm_username(settings.PLATFORM_ROOT_USERNAME)
        password = settings.PLATFORM_ROOT_PASSWORD or ""
        root = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.is_root.is_(True)).first()
        result = {"root": "none"}

        problem = None
        if username or password:
            if not USERNAME_RE.match(username):
                problem = "PLATFORM_ROOT_USERNAME must be 3-40 characters: a-z, 0-9, _ . -"
            elif len(password) < 8 or len(password.encode("utf-8")) > 72:
                problem = "PLATFORM_ROOT_PASSWORD must be 8-72 bytes long"
            else:
                clash = db.query(pm.PlatformAdmin).filter(
                    pm.PlatformAdmin.username == username, pm.PlatformAdmin.is_root.is_(False)).first()
                if clash is not None:
                    problem = f"PLATFORM_ROOT_USERNAME '{username}' is already used by another platform admin"
        configured = bool(username and password) and problem is None

        if configured:
            if root is None:
                root = pm.PlatformAdmin(
                    username=username, display_name="Root", hashed_password=get_password_hash(password),
                    is_root=True, is_active=True,
                    can_view_system_health=True, can_view_analytics=True, can_manage_users=True,
                    can_manage_projects=True, can_view_audit_logs=True,
                )
                db.add(root)
                db.flush()
                write_audit(db, "root_created", actor_name="system", target_type="admin",
                            target_id=root.id, target_name=root.username)
                result["root"] = "created"
            else:
                changed = []
                if root.username != username:
                    root.username = username
                    changed.append("username")
                if not verify_password(password, root.hashed_password):
                    root.hashed_password = get_password_hash(password)
                    changed.append("password")
                if not root.is_active:
                    root.is_active = True
                    changed.append("enabled")
                for flag in pm.PERMISSION_FLAGS:
                    if not getattr(root, flag):
                        setattr(root, flag, True)
                        changed.append(flag)
                if changed:
                    write_audit(db, "root_updated", actor_name="system", target_type="admin",
                                target_id=root.id, target_name=root.username, details={"changed": changed})
                result["root"] = "updated" if changed else "unchanged"
        else:
            if problem:
                print(f"[platform] {problem}. The root account is not changed.")
                result["root"] = "invalid"
            elif root is not None and root.is_active:
                root.is_active = False
                write_audit(db, "root_disabled", actor_name="system", target_type="admin",
                            target_id=root.id, target_name=root.username,
                            details={"reason": "PLATFORM_ROOT_USERNAME / PLATFORM_ROOT_PASSWORD are not set"})
                result["root"] = "disabled"
        db.commit()

        active = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.is_active.is_(True)).count()
        result["active_admins"] = active
        if active == 0:
            print(f"[platform] {NO_ADMINS_NOTICE}")
        return result
    finally:
        db.close()
