"""Projects of the Rapid Task app, seen by the platform admins.
List (permission: can_view_analytics): search, status and warning filters, sort, pages.
Archive, restore, suspend, unsuspend and delete: root admin only. Every change is written to the audit log.
  archived  = hidden from the members' lists (the project answers 404 to its members)
  suspended = the members are blocked and see "Project suspended" and the reason
The app data and the audit log are two databases: the change is saved first, then the log line."""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import crud, models
from app import platform_insights_logic as il
from app import platform_logic as logic
from app import platform_models as pm
from app import platform_schemas as schemas
from app.database import get_db
from app.platform_auth import require_permission, require_root
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform/insights", tags=["platform"])
can_view_analytics = require_permission("can_view_analytics")

SORTS = {                                     # (key, reverse); ties: newest project first
    "created": (lambda p, m: p.created_at or datetime.min, True),
    "name": (lambda p, m: (p.name or "").lower(), False),
    "tickets": (lambda p, m: m["tickets_total"], True),
    "members": (lambda p, m: m["members_count"], True),
    "activity": (lambda p, m: m["last_activity_at"] or datetime.min, True),
}


def _out(p: models.Project, m: dict) -> schemas.PlatformProjectOut:
    return schemas.PlatformProjectOut(
        id=p.id, name=p.name, key=p.key, status=p.status or "active", status_reason=p.status_reason,
        status_changed_at=p.status_changed_at, created_at=p.created_at,
        owner_name=p.owner.full_name if p.owner else "", owner_email=p.owner.email if p.owner else "", **m)


def _one(db: Session, p: models.Project) -> schemas.PlatformProjectOut:
    return _out(p, il.project_metrics(db, [p])[p.id])


def _load(db: Session, project_id: int) -> models.Project:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _log(pdb: Session, action: str, admin: pm.PlatformAdmin, request: Request, project: models.Project,
         reason: Optional[str] = None) -> None:
    details = {"key": project.key}
    if reason:
        details["reason"] = reason
    logic.write_audit(pdb, action, actor=admin, target_type="project", target_id=project.id, target_name=project.name,
                      ip=logic.client_ip(request), details=details)
    pdb.commit()


def _change(db: Session, project: models.Project, status: str, reason: Optional[str]) -> None:
    project.status = status
    project.status_reason = reason or None
    project.status_changed_at = datetime.utcnow()
    db.commit()
    db.refresh(project)


def _need(project: models.Project, status: str, message: str) -> None:
    if (project.status or "active") != status:
        raise HTTPException(status_code=409, detail=message)


@router.get("/projects", response_model=schemas.PlatformProjectPage)
def list_projects(
    q: Optional[str] = Query(None, max_length=100),
    status: Optional[str] = Query(None, pattern="^(active|archived|suspended)$"),
    flag: Optional[str] = Query(None, pattern="^(inactive|empty)$"),
    sort: str = Query("created", pattern="^(created|name|tickets|members|activity)$"),
    page: int = Query(1, ge=1, le=100000),
    page_size: int = Query(25, ge=1, le=100),
    admin: pm.PlatformAdmin = Depends(can_view_analytics),
    db: Session = Depends(get_db),
):
    P = models.Project
    query = db.query(P)
    text = (q or "").strip().lower()
    if text:
        owner_ids = db.query(models.User.id).filter(or_(
            func.lower(models.User.full_name).contains(text, autoescape=True),
            func.lower(models.User.email).contains(text, autoescape=True)))
        query = query.filter(or_(func.lower(P.name).contains(text, autoescape=True),
                                 func.lower(P.key).contains(text, autoescape=True),
                                 P.owner_id.in_(owner_ids)))
    found = query.all()
    metrics = il.project_metrics(db, found)
    counts = {s: sum(1 for p in found if (p.status or "active") == s) for s in il.STATUSES}
    counts["all"] = len(found)
    flags = {"inactive": sum(1 for p in found if metrics[p.id]["inactive"]),
             "empty": sum(1 for p in found if metrics[p.id]["empty"])}
    rows = [p for p in found
            if (not status or (p.status or "active") == status) and (not flag or metrics[p.id][flag])]
    key, reverse = SORTS[sort]
    rows.sort(key=lambda p: p.id, reverse=True)                       # the tie order
    rows.sort(key=lambda p: key(p, metrics[p.id]), reverse=reverse)   # stable: ties keep the order above
    total = len(rows)
    part = rows[(page - 1) * page_size: page * page_size]
    return schemas.PlatformProjectPage(items=[_out(p, metrics[p.id]) for p in part], total=total, page=page,
                                       page_size=page_size, counts=counts, flags=flags)


@router.post("/projects/{project_id}/archive", response_model=schemas.PlatformProjectOut)
def archive_project(project_id: int, request: Request, payload: schemas.PlatformProjectReason = schemas.PlatformProjectReason(),
                    admin: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_db),
                    pdb: Session = Depends(get_platform_db)):
    project = _load(db, project_id)
    _need(project, "active", "Only an active project can be archived")
    _change(db, project, "archived", (payload.reason or "").strip())
    _log(pdb, "project_archived", admin, request, project, project.status_reason)
    return _one(db, project)


@router.post("/projects/{project_id}/restore", response_model=schemas.PlatformProjectOut)
def restore_project(project_id: int, request: Request, admin: pm.PlatformAdmin = Depends(require_root),
                    db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    project = _load(db, project_id)
    _need(project, "archived", "This project is not archived")
    _change(db, project, "active", None)
    _log(pdb, "project_restored", admin, request, project)
    return _one(db, project)


@router.post("/projects/{project_id}/suspend", response_model=schemas.PlatformProjectOut)
def suspend_project(project_id: int, payload: schemas.PlatformProjectReason, request: Request,
                    admin: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_db),
                    pdb: Session = Depends(get_platform_db)):
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required")      # the members will read it
    project = _load(db, project_id)
    _need(project, "active", "Only an active project can be suspended")
    _change(db, project, "suspended", reason)
    _log(pdb, "project_suspended", admin, request, project, reason)
    return _one(db, project)


@router.post("/projects/{project_id}/unsuspend", response_model=schemas.PlatformProjectOut)
def unsuspend_project(project_id: int, request: Request, admin: pm.PlatformAdmin = Depends(require_root),
                      db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    project = _load(db, project_id)
    _need(project, "suspended", "This project is not suspended")
    _change(db, project, "active", None)
    _log(pdb, "project_unsuspended", admin, request, project)
    return _one(db, project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, request: Request, admin: pm.PlatformAdmin = Depends(require_root),
                   db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    """Real delete: tickets, comments, history, files and the project itself are removed (any status)."""
    project = _load(db, project_id)
    info = (project.id, project.key, project.name, il.project_metrics(db, [project])[project.id]["tickets_total"])
    crud.delete_project(db, project)
    logic.write_audit(pdb, "project_deleted", actor=admin, target_type="project", target_id=info[0], target_name=info[2],
                      ip=logic.client_ip(request), details={"key": info[1], "tickets": info[3]})
    pdb.commit()
    return Response(status_code=204)
