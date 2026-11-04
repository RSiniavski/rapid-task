"""System health for the platform admins (permission: can_view_system_health; root has it always).
Read-only: server and uptime, the two databases, the disk, counts, load and the latest server errors."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import files, models
from app import platform_health as health
from app import platform_models as pm
from app import platform_schemas as schemas
from app.config import settings
from app.database import engine, get_db
from app.platform_auth import require_permission
from app.platform_db import platform_engine

router = APIRouter(prefix="/api/platform/health", tags=["platform"])
can_view_health = require_permission("can_view_system_health")


@router.get("", response_model=schemas.HealthOut)
def get_health(request: Request, admin: pm.PlatformAdmin = Depends(can_view_health), db: Session = Depends(get_db)):
    s = settings
    databases = [health.database_info("app", engine), health.database_info("platform", platform_engine)]
    disk = health.disk_info(files.BASE_DIR, files.UPLOAD_DIR, s.HEALTH_DISK_WARN_PERCENT, s.HEALTH_DISK_CRITICAL_PERCENT)
    load = health.load()
    errors_level = health.level_for(load["errors_last_hour"], s.HEALTH_ERRORS_WARN, s.HEALTH_ERRORS_CRITICAL)
    try:
        counts = {
            "users": db.query(models.User).filter(models.User.deleted_at.is_(None)).count(),
            "projects": db.query(models.Project).count(),
            "tickets": db.query(models.Ticket).count(),
        }
    except Exception:                                    # a broken app database is already shown in "databases"
        counts = {"users": 0, "projects": 0, "tickets": 0}
    levels = [disk["level"], errors_level] + ["ok" if d["ok"] else "critical" for d in databases]
    return schemas.HealthOut(
        status=health.worst(levels),
        server=health.server_info(request.app.version),
        databases=databases, disk=disk, counts=counts,
        load={**load, "errors_level": errors_level},
        recent_errors=health.recent_errors(),
        limits={"disk_warn_percent": s.HEALTH_DISK_WARN_PERCENT, "disk_critical_percent": s.HEALTH_DISK_CRITICAL_PERCENT,
                "errors_warn": s.HEALTH_ERRORS_WARN, "errors_critical": s.HEALTH_ERRORS_CRITICAL},
    )


if settings.PLATFORM_HEALTH_DEBUG:
    @router.post("/_raise", include_in_schema=False)
    def raise_on_purpose(admin: pm.PlatformAdmin = Depends(can_view_health)):
        """Tests only (needs PLATFORM_HEALTH_DEBUG=1): an unhandled error, to see how it is counted and shown."""
        raise RuntimeError("raised on purpose by the health test route")
