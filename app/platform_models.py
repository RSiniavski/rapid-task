"""Tables of platform.db: platform administrators, login locks, audit log."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean

from app.platform_db import PlatformBase

PERMISSION_FLAGS = [
    "can_view_system_health",
    "can_view_analytics",
    "can_manage_users",
    "can_manage_projects",
    "can_view_audit_logs",
    "can_manage_pages",
]


class PlatformAdmin(PlatformBase):
    __tablename__ = "platform_admins"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)   # always stored in lower case
    display_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_root = Column(Boolean, default=False, nullable=False)             # set only from .env, never from the web
    is_active = Column(Boolean, default=True, nullable=False)
    can_view_system_health = Column(Boolean, default=False, nullable=False)
    can_view_analytics = Column(Boolean, default=False, nullable=False)
    can_manage_users = Column(Boolean, default=False, nullable=False)
    can_manage_projects = Column(Boolean, default=False, nullable=False)
    can_view_audit_logs = Column(Boolean, default=False, nullable=False)
    can_manage_pages = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    theme_key = Column(String, nullable=True)                            # the admin's own look of the admin tool


class PlatformLoginLock(PlatformBase):
    """Failed login counter per typed username (also for names that do not exist: same behaviour for all)."""
    __tablename__ = "platform_login_locks"

    username = Column(String, primary_key=True)
    failed_count = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class PlatformAuditLog(PlatformBase):
    __tablename__ = "platform_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    actor_id = Column(Integer, nullable=True)
    actor_name = Column(String, nullable=True)       # a copy of the name: the log stays readable after changes
    action = Column(String, index=True, nullable=False)
    target_type = Column(String, nullable=True)
    target_id = Column(Integer, nullable=True)
    target_name = Column(String, nullable=True)
    details = Column(Text, nullable=True)            # JSON text, never contains passwords
    ip = Column(String, nullable=True)


class SitePage(PlatformBase):
    """A public page of the site (Donate, Terms, Privacy ...). Text per language (uk / en), Markdown.
    draft = not public, published = public at /p/<slug>."""
    __tablename__ = "site_pages"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, index=True, nullable=False)
    title_uk = Column(String, default="", nullable=False)
    title_en = Column(String, default="", nullable=False)
    content_uk = Column(Text, default="", nullable=False)
    content_en = Column(Text, default="", nullable=False)
    status = Column(String, default="draft", nullable=False, index=True)       # draft | published
    in_footer = Column(Boolean, default=False, nullable=False)                 # link in the site footer
    in_register = Column(Boolean, default=False, nullable=False)               # link in the register form
    sort_order = Column(Integer, default=0, nullable=False)
    is_system = Column(Boolean, default=False, nullable=False)                 # a system page cannot be deleted, its slug is fixed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)
    updated_by = Column(String, nullable=True)                                 # the admin's username
