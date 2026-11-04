"""Rules for the platform admins who manage the app's users (block, unblock, soft delete)."""
import secrets
from datetime import datetime

from sqlalchemy import and_

from app import models
from app.auth import get_password_hash

STATUSES = ("active", "blocked", "deactivated", "deleted")


def status_of(user: models.User) -> str:
    """deleted: removed by a platform admin | deactivated: the user closed the account himself |
    blocked: cannot log in, data stays | active."""
    if user.deleted_at is not None:
        return "deleted"
    if not user.is_active:
        return "deactivated"
    if user.is_blocked:
        return "blocked"
    return "active"


def status_condition(status: str):
    """The same rules as status_of(), as a SQL condition (for filters and counters)."""
    U = models.User
    if status == "deleted":
        return U.deleted_at.isnot(None)
    if status == "deactivated":
        return and_(U.deleted_at.is_(None), U.is_active.is_(False))
    if status == "blocked":
        return and_(U.deleted_at.is_(None), U.is_active.is_(True), U.is_blocked.is_(True))
    return and_(U.deleted_at.is_(None), U.is_active.is_(True), U.is_blocked.is_(False))


def soft_delete(db, user: models.User) -> str:
    """The account stops working, the name and all work stay (tickets, comments, history, assignments).
    The e-mail gets the prefix deleted_<id>_ so the real address can be registered again.
    Returns the original e-mail (for the audit log). The caller commits."""
    original = user.email
    local, _, domain = original.rpartition("@")
    local = f"deleted_{user.id}_{local}"[:64]                 # an e-mail name may have 64 characters at most
    user.email = f"{local}@{domain}"
    user.hashed_password = get_password_hash(secrets.token_urlsafe(32))      # nobody knows this password
    user.is_active = False
    user.deleted_at = datetime.utcnow()
    return original
