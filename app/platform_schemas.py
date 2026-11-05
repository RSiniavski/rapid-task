import json
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.platform_logic import USERNAME_RE
from app.theme_presets import PRESETS

THEME_KEYS = {p["key"] for p in PRESETS}


class PlatformLoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=60)
    password: str = Field(..., min_length=1, max_length=128)


class PlatformAdminOut(BaseModel):
    id: int
    username: str
    display_name: str
    is_root: bool
    is_active: bool
    can_view_system_health: bool
    can_view_analytics: bool
    can_manage_users: bool
    can_manage_projects: bool
    can_view_audit_logs: bool
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    theme_key: Optional[str] = None            # None = the default look
    model_config = ConfigDict(from_attributes=True)


class PlatformThemeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme_key: Optional[str] = Field(None, max_length=60)          # null = back to the default

    @field_validator("theme_key")
    @classmethod
    def _known_theme(cls, v):
        if v is not None and v not in THEME_KEYS:
            raise ValueError("unknown theme")
        return v


class PlatformTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: PlatformAdminOut


class PlatformStatusOut(BaseModel):
    has_admins: bool          # at least one active platform administrator exists
    root_configured: bool     # the root account from .env is active


# ------------------------------------------------------------------ admin management (root only)
class PlatformAdminCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")          # is_root and any unknown field are refused (422)
    username: str = Field(..., max_length=60)
    display_name: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=8, max_length=72)
    can_view_system_health: bool = False
    can_view_analytics: bool = False
    can_manage_users: bool = False
    can_manage_projects: bool = False
    can_view_audit_logs: bool = False

    @field_validator("username", mode="before")
    @classmethod
    def _lower_username(cls, v):
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("username")
    @classmethod
    def _username_shape(cls, v):
        if not USERNAME_RE.match(v):
            raise ValueError("username must be 3-40 characters: a-z, 0-9, _ . - (starts with a letter or digit)")
        return v

    @field_validator("display_name", mode="before")
    @classmethod
    def _trim_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("password")
    @classmethod
    def _password_bytes(cls, v):
        if len(v.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 bytes")
        return v


class PlatformAdminUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: Optional[str] = Field(None, min_length=2, max_length=100)
    is_active: Optional[bool] = None
    can_view_system_health: Optional[bool] = None
    can_view_analytics: Optional[bool] = None
    can_manage_users: Optional[bool] = None
    can_manage_projects: Optional[bool] = None
    can_view_audit_logs: Optional[bool] = None

    @field_validator("display_name", mode="before")
    @classmethod
    def _trim_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _something_to_change(self):
        if all(getattr(self, f) is None for f in type(self).model_fields):
            raise ValueError("nothing to change")
        return self


class PlatformPasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(..., min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def _password_bytes(cls, v):
        if len(v.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 bytes")
        return v


# ------------------------------------------------------------------ users of the app (permission: can_manage_users)
class PlatformUserOut(BaseModel):
    id: int
    email: str                        # a soft-deleted user shows the changed address (deleted_<id>_...)
    full_name: str
    position: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str                       # active | blocked | deactivated | deleted
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    projects_count: int = 0           # projects where the user is a member
    assigned_open_count: int = 0      # assigned tickets that are not in a "done" column
    reported_count: int = 0           # tickets created by the user


class PlatformUserPage(BaseModel):
    items: List[PlatformUserOut]
    total: int
    page: int
    page_size: int
    counts: dict                      # users per status (all, active, blocked, deactivated, deleted), for the search text


# ------------------------------------------------------------------ audit log
class PlatformAuditOut(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    actor_id: Optional[int] = None
    actor_name: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[int] = None
    target_name: Optional[str] = None
    details: Optional[dict] = None
    ip: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

    @field_validator("details", mode="before")
    @classmethod
    def _parse_details(cls, v):
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
            except ValueError:
                return {"raw": v}
            return parsed if isinstance(parsed, dict) else {"value": parsed}
        return v


class PlatformAuditPage(BaseModel):
    items: List[PlatformAuditOut]
    total: int
    page: int
    page_size: int


# ------------------------------------------------------------------ system health (permission: can_view_system_health)
class HealthServer(BaseModel):
    app_version: str
    python_version: str
    started_at: datetime
    now: datetime
    uptime_seconds: int


class HealthDatabase(BaseModel):
    name: str                         # app | platform
    file: Optional[str] = None        # the file name only, no folders
    ok: bool
    size_bytes: Optional[int] = None
    error: Optional[str] = None       # the error class name, if the database does not answer


class HealthDisk(BaseModel):
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_percent: float
    level: str                        # ok | warning | critical
    uploads_bytes: int
    uploads_files: int


class HealthCounts(BaseModel):
    users: int                        # accounts that are not soft-deleted
    projects: int
    tickets: int


class HealthLoad(BaseModel):
    requests_last_minute: int
    requests_total: int
    errors_last_hour: int
    errors_total: int
    errors_level: str                 # ok | warning | critical


class HealthError(BaseModel):
    at: datetime
    method: str
    path: str
    status: int
    error: str


class HealthOut(BaseModel):
    status: str                       # the worst of all levels: ok | warning | critical
    server: HealthServer
    databases: List[HealthDatabase]
    disk: HealthDisk
    counts: HealthCounts
    load: HealthLoad
    recent_errors: List[HealthError]
    limits: dict                      # the limits used for the colors


# ------------------------------------------------------------------ overview (permission: can_view_analytics)
class OverviewPeriod(BaseModel):
    days: int
    first_day: str                    # UTC, YYYY-MM-DD
    last_day: str                     # today, UTC


class OverviewUsers(BaseModel):
    total: int                        # accounts that are not soft-deleted
    active: int
    blocked: int
    deactivated: int
    deleted: int
    new: int                          # registered in the period


class OverviewProjects(BaseModel):
    total: int
    new: int
    with_activity: int                # a ticket was created or changed in the period


class OverviewTickets(BaseModel):
    total: int
    open: int                         # not in a "done" column
    created: int                      # in the period
    done: int                         # closed in the period


class OverviewActivity(BaseModel):
    comments: int
    attachments: int


class OverviewSeries(BaseModel):
    days: List[str]
    new_users: List[int]
    new_projects: List[int]
    new_tickets: List[int]
    active_users: List[int]


class OverviewStatus(BaseModel):
    name: str
    count: int
    is_done: bool


class OverviewType(BaseModel):
    type: str
    count: int


class OverviewOut(BaseModel):
    period: OverviewPeriod
    users: OverviewUsers
    projects: OverviewProjects
    tickets: OverviewTickets
    activity: OverviewActivity
    series: OverviewSeries
    activity_since: Optional[str] = None     # the first day with saved activity (the chart is empty before it)
    tickets_by_status: List[OverviewStatus]
    tickets_by_type: List[OverviewType]
