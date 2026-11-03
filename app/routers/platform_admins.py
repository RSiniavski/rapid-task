"""Platform administrators: list, create, change permissions / block, reset password, delete. Root only.
The root account itself (from .env) can not be changed, blocked or deleted here."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import platform_logic as logic
from app import platform_models as pm
from app import platform_schemas as schemas
from app.auth import get_password_hash
from app.platform_auth import require_root
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform/admins", tags=["platform"])


def _get_admin(db: Session, admin_id: int) -> pm.PlatformAdmin:
    admin = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.id == admin_id).first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    return admin


def _not_root(admin: pm.PlatformAdmin) -> None:
    if admin.is_root:
        raise HTTPException(status_code=403, detail="The root account is managed in .env and can not be changed here")


@router.get("", response_model=List[schemas.PlatformAdminOut])
def list_admins(root: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_platform_db)):
    return db.query(pm.PlatformAdmin).order_by(pm.PlatformAdmin.is_root.desc(), pm.PlatformAdmin.id).all()


@router.post("", response_model=schemas.PlatformAdminOut, status_code=status.HTTP_201_CREATED)
def create_admin(body: schemas.PlatformAdminCreate, request: Request,
                 root: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_platform_db)):
    if db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.username == body.username).first():
        raise HTTPException(status_code=409, detail="This username is already used")
    flags = {f: getattr(body, f) for f in pm.PERMISSION_FLAGS}
    admin = pm.PlatformAdmin(
        username=body.username, display_name=body.display_name,
        hashed_password=get_password_hash(body.password),
        is_root=False, is_active=True, created_by_id=root.id, **flags,
    )
    db.add(admin)
    try:
        db.flush()
    except IntegrityError:                                    # two requests with the same name at once
        db.rollback()
        raise HTTPException(status_code=409, detail="This username is already used")
    logic.write_audit(db, "admin_created", actor=root, target_type="admin", target_id=admin.id,
                      target_name=admin.username, ip=logic.client_ip(request),
                      details={"display_name": admin.display_name,
                               "permissions": [f for f, on in flags.items() if on]})
    db.commit()
    db.refresh(admin)
    return admin


@router.patch("/{admin_id}", response_model=schemas.PlatformAdminOut)
def update_admin(admin_id: int, body: schemas.PlatformAdminUpdate, request: Request,
                 root: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_platform_db)):
    admin = _get_admin(db, admin_id)
    _not_root(admin)
    changes = {}
    for field, value in body.model_dump(exclude_none=True).items():
        old = getattr(admin, field)
        if old != value:
            changes[field] = [old, value]
            setattr(admin, field, value)
    if not changes:
        return admin
    action = "admin_updated"
    if "is_active" in changes:
        action = "admin_enabled" if admin.is_active else "admin_disabled"
    logic.write_audit(db, action, actor=root, target_type="admin", target_id=admin.id,
                      target_name=admin.username, ip=logic.client_ip(request), details={"changed": changes})
    db.commit()
    db.refresh(admin)
    return admin


@router.post("/{admin_id}/password", response_model=schemas.PlatformAdminOut)
def reset_password(admin_id: int, body: schemas.PlatformPasswordReset, request: Request,
                   root: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_platform_db)):
    admin = _get_admin(db, admin_id)
    _not_root(admin)
    admin.hashed_password = get_password_hash(body.password)
    logic.clear_failures(db, admin.username)                  # a locked admin can try again with the new password
    logic.write_audit(db, "admin_password_reset", actor=root, target_type="admin", target_id=admin.id,
                      target_name=admin.username, ip=logic.client_ip(request))     # the password is never logged
    db.commit()
    db.refresh(admin)
    return admin


@router.delete("/{admin_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin(admin_id: int, request: Request,
                 root: pm.PlatformAdmin = Depends(require_root), db: Session = Depends(get_platform_db)):
    admin = _get_admin(db, admin_id)
    _not_root(admin)
    logic.write_audit(db, "admin_deleted", actor=root, target_type="admin", target_id=admin.id,
                      target_name=admin.username, ip=logic.client_ip(request))
    logic.clear_failures(db, admin.username)
    db.delete(admin)                  # the audit rows keep the name of the admin (a copy), so the log stays readable
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
