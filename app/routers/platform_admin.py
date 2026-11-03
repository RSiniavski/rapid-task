"""Platform (admin tool) API: status, login, current admin. Admin management and the audit log come next."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import platform_logic as logic
from app import platform_models as pm
from app import platform_schemas as schemas
from app.auth import verify_password, get_password_hash
from app.config import settings
from app.platform_auth import create_platform_token, get_current_admin
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform", tags=["platform"])

_DUMMY_HASH = get_password_hash("not-a-real-password")      # so an unknown name costs the same time as a real one


def _ip(request: Request):
    return request.client.host if request.client else None


@router.get("/status", response_model=schemas.PlatformStatusOut)
def platform_status(db: Session = Depends(get_platform_db)):
    """Public. Only two yes/no values: the login page uses them to show the 'no admins here' notice."""
    active = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.is_active.is_(True))
    return schemas.PlatformStatusOut(
        has_admins=active.count() > 0,
        root_configured=active.filter(pm.PlatformAdmin.is_root.is_(True)).count() > 0,
    )


@router.post("/auth/login", response_model=schemas.PlatformTokenOut)
def platform_login(body: schemas.PlatformLoginIn, request: Request, db: Session = Depends(get_platform_db)):
    username = logic.norm_username(body.username)
    ip = _ip(request)

    minutes = logic.lock_state(db, username)
    if minutes:
        logic.write_audit(db, "login_blocked", actor_name=username, ip=ip, details={"reason": "locked"})
        db.commit()
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=f"Too many failed attempts. Try again in {minutes} min.",
                            headers={"Retry-After": str(minutes * 60)})

    admin = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.username == username).first()
    password_ok = verify_password(body.password, admin.hashed_password if admin else _DUMMY_HASH)
    if admin is None or not password_ok:
        locked_now = logic.register_failure(db, username)
        logic.write_audit(db, "login_failed", actor_name=username, ip=ip, details={"locked": locked_now})
        db.commit()
        if locked_now:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail=f"Too many failed attempts. Try again in {settings.PLATFORM_LOCK_MINUTES} min.",
                                headers={"Retry-After": str(settings.PLATFORM_LOCK_MINUTES * 60)})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    if not admin.is_active:
        logic.write_audit(db, "login_denied", actor=admin, ip=ip, details={"reason": "disabled"})
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled")

    logic.clear_failures(db, username)
    admin.last_login_at = datetime.utcnow()
    logic.write_audit(db, "login_ok", actor=admin, ip=ip)
    db.commit()
    db.refresh(admin)
    return schemas.PlatformTokenOut(access_token=create_platform_token(admin),
                                    admin=schemas.PlatformAdminOut.model_validate(admin))


@router.get("/auth/me", response_model=schemas.PlatformAdminOut)
def platform_me(admin: pm.PlatformAdmin = Depends(get_current_admin)):
    return admin


@router.put("/auth/me/theme", response_model=schemas.PlatformAdminOut)
def set_my_theme(body: schemas.PlatformThemeIn, admin: pm.PlatformAdmin = Depends(get_current_admin),
                 db: Session = Depends(get_platform_db)):
    """Every admin picks the look of the admin tool for themselves (one of the built-in presets)."""
    admin.theme_key = body.theme_key
    db.commit()
    db.refresh(admin)
    return admin
