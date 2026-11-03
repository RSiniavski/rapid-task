"""Audit log of the platform: who did what. Needs the can_view_audit_logs permission (root has it always)."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app import platform_models as pm
from app import platform_schemas as schemas
from app.platform_auth import require_permission
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform/audit", tags=["platform"])
can_view_audit = require_permission("can_view_audit_logs")


def _contains(column, text: str):
    return func.lower(column).contains(text.strip().lower(), autoescape=True)    # % and _ in the text are plain characters


@router.get("", response_model=schemas.PlatformAuditPage)
def list_audit(
    page: int = Query(1, ge=1, le=100000),
    page_size: int = Query(50, ge=1, le=100),
    action: Optional[str] = Query(None, max_length=60),
    actor: Optional[str] = Query(None, max_length=60),
    target: Optional[str] = Query(None, max_length=100),
    admin: pm.PlatformAdmin = Depends(can_view_audit),
    db: Session = Depends(get_platform_db),
):
    q = db.query(pm.PlatformAuditLog)
    if action:
        q = q.filter(pm.PlatformAuditLog.action == action)
    if actor and actor.strip():
        q = q.filter(_contains(pm.PlatformAuditLog.actor_name, actor))
    if target and target.strip():
        q = q.filter(_contains(pm.PlatformAuditLog.target_name, target))
    total = q.count()
    rows = q.order_by(desc(pm.PlatformAuditLog.id)).offset((page - 1) * page_size).limit(page_size).all()
    return schemas.PlatformAuditPage(
        items=[schemas.PlatformAuditOut.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size)


@router.get("/actions", response_model=List[str])
def list_audit_actions(admin: pm.PlatformAdmin = Depends(can_view_audit), db: Session = Depends(get_platform_db)):
    """The action names that exist in the log (for the filter dropdown)."""
    rows = db.query(pm.PlatformAuditLog.action).distinct().order_by(pm.PlatformAuditLog.action).all()
    return [r[0] for r in rows]
