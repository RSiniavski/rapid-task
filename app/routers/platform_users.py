"""Users of the Rapid Task app, seen by the platform admins (permission: can_manage_users).
List with search / status filter / pages, block, unblock, soft delete. Every change is written to the audit log.
The app data and the audit log are two databases: the change is saved first, then the log line."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app import platform_logic as logic
from app import platform_models as pm
from app import platform_schemas as schemas
from app import platform_users_logic as ul
from app.database import get_db
from app.platform_auth import require_permission
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform/users", tags=["platform"])
can_manage_users = require_permission("can_manage_users")

SORTS = {
    "created": lambda U: (U.created_at.desc(), U.id.desc()),
    "name": lambda U: (func.lower(U.full_name).asc(), U.id.asc()),
    "last_login": lambda U: (U.last_login_at.is_(None).asc(), U.last_login_at.desc(), U.id.desc()),
}


def _search(q, text: Optional[str]):
    text = (text or "").strip().lower()
    if not text:
        return q
    U = models.User
    return q.filter(or_(func.lower(U.full_name).contains(text, autoescape=True),
                        func.lower(U.email).contains(text, autoescape=True)))


def _items(db: Session, users) -> list:
    ids = [u.id for u in users]
    projects, assigned, reported = {}, {}, {}
    if ids:
        projects = dict(db.query(models.ProjectMember.user_id, func.count(models.ProjectMember.id))
                        .filter(models.ProjectMember.user_id.in_(ids)).group_by(models.ProjectMember.user_id).all())
        assigned = dict(db.query(models.Ticket.assignee_id, func.count(models.Ticket.id))
                        .join(models.BoardColumn, models.Ticket.column_id == models.BoardColumn.id)
                        .filter(models.Ticket.assignee_id.in_(ids), models.BoardColumn.is_done.is_(False))
                        .group_by(models.Ticket.assignee_id).all())
        reported = dict(db.query(models.Ticket.reporter_id, func.count(models.Ticket.id))
                        .filter(models.Ticket.reporter_id.in_(ids)).group_by(models.Ticket.reporter_id).all())
    return [schemas.PlatformUserOut(
        id=u.id, email=u.email, full_name=u.full_name, position=u.position, avatar_url=u.avatar_url,
        status=ul.status_of(u), created_at=u.created_at, last_login_at=u.last_login_at, deleted_at=u.deleted_at,
        projects_count=projects.get(u.id, 0), assigned_open_count=assigned.get(u.id, 0),
        reported_count=reported.get(u.id, 0)) for u in users]


def _load(db: Session, user_id: int) -> models.User:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _log(pdb: Session, action: str, admin: pm.PlatformAdmin, request: Request, user: models.User, email: str) -> None:
    logic.write_audit(pdb, action, actor=admin, target_type="user", target_id=user.id, target_name=email,
                      ip=logic.client_ip(request), details={"full_name": user.full_name})
    pdb.commit()


@router.get("", response_model=schemas.PlatformUserPage)
def list_users(
    q: Optional[str] = Query(None, max_length=100),
    status: Optional[str] = Query(None, pattern="^(active|blocked|deactivated|deleted)$"),
    sort: str = Query("created", pattern="^(created|name|last_login)$"),
    page: int = Query(1, ge=1, le=100000),
    page_size: int = Query(25, ge=1, le=100),
    admin: pm.PlatformAdmin = Depends(can_manage_users),
    db: Session = Depends(get_db),
):
    U = models.User
    base = _search(db.query(U), q)
    counts = {s: base.filter(ul.status_condition(s)).count() for s in ul.STATUSES}
    counts["all"] = sum(counts.values())
    query = base.filter(ul.status_condition(status)) if status else base
    total = counts[status] if status else counts["all"]
    users = query.order_by(*SORTS[sort](U)).offset((page - 1) * page_size).limit(page_size).all()
    return schemas.PlatformUserPage(items=_items(db, users), total=total, page=page, page_size=page_size, counts=counts)


@router.post("/{user_id}/block", response_model=schemas.PlatformUserOut)
def block_user(user_id: int, request: Request, admin: pm.PlatformAdmin = Depends(can_manage_users),
               db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    user = _load(db, user_id)
    state = ul.status_of(user)
    if state == "blocked":
        raise HTTPException(status_code=409, detail="This user is already blocked")
    if state != "active":
        raise HTTPException(status_code=409, detail="Only active users can be blocked")
    user.is_blocked = True
    db.commit()
    _log(pdb, "user_blocked", admin, request, user, user.email)
    return _items(db, [user])[0]


@router.post("/{user_id}/unblock", response_model=schemas.PlatformUserOut)
def unblock_user(user_id: int, request: Request, admin: pm.PlatformAdmin = Depends(can_manage_users),
                 db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    user = _load(db, user_id)
    if ul.status_of(user) != "blocked":
        raise HTTPException(status_code=409, detail="This user is not blocked")
    user.is_blocked = False
    db.commit()
    _log(pdb, "user_unblocked", admin, request, user, user.email)
    return _items(db, [user])[0]


@router.delete("/{user_id}", response_model=schemas.PlatformUserOut)
def delete_user(user_id: int, request: Request, admin: pm.PlatformAdmin = Depends(can_manage_users),
                db: Session = Depends(get_db), pdb: Session = Depends(get_platform_db)):
    """Soft delete (nothing is removed from the database). Returns the user with status "deleted"."""
    user = _load(db, user_id)
    if ul.status_of(user) == "deleted":
        raise HTTPException(status_code=409, detail="This user is already deleted")
    original = ul.soft_delete(db, user)
    db.commit()
    _log(pdb, "user_deleted", admin, request, user, original)
    return _items(db, [user])[0]
