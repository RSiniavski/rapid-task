"""Tokens and permission checks for platform administrators.
A platform token can never be used as an app token and the other way round:
  - it is signed with its own key (PLATFORM_SECRET_KEY, or the app key + ':platform'),
  - its subject is 'padmin:<id>' (the app needs a plain number) and it carries scope 'platform'."""
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.platform_db import get_platform_db
from app import platform_models as pm

PLATFORM_SCOPE = "platform"
SUB_PREFIX = "padmin:"
oauth2_platform = OAuth2PasswordBearer(tokenUrl="/api/platform/auth/login")


def _key() -> str:
    return settings.PLATFORM_SECRET_KEY or (settings.SECRET_KEY + ":platform")


def create_platform_token(admin: pm.PlatformAdmin) -> str:
    payload = {
        "sub": f"{SUB_PREFIX}{admin.id}",
        "scope": PLATFORM_SCOPE,
        "exp": datetime.utcnow() + timedelta(minutes=settings.PLATFORM_TOKEN_MINUTES),
    }
    return jwt.encode(payload, _key(), algorithm=settings.ALGORITHM)


def get_current_admin(token: str = Depends(oauth2_platform),
                      db: Session = Depends(get_platform_db)) -> pm.PlatformAdmin:
    bad = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials",
                        headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, _key(), algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        if payload.get("scope") != PLATFORM_SCOPE or not isinstance(sub, str) or not sub.startswith(SUB_PREFIX):
            raise bad
        admin_id = int(sub[len(SUB_PREFIX):])
        if not 0 < admin_id < 2 ** 63:
            raise bad
    except (JWTError, ValueError, TypeError):
        raise bad
    admin = db.query(pm.PlatformAdmin).filter(pm.PlatformAdmin.id == admin_id).first()
    if admin is None:
        raise bad
    if not admin.is_active:                       # a blocked admin loses access at once, also with an old token
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled")
    return admin


def require_root(admin: pm.PlatformAdmin = Depends(get_current_admin)) -> pm.PlatformAdmin:
    if not admin.is_root:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the root admin can do this")
    return admin


def require_permission(flag: str):
    """Dependency factory: root passes always, other admins need the flag."""
    if flag not in pm.PERMISSION_FLAGS:
        raise ValueError(f"unknown permission flag: {flag}")

    def dep(admin: pm.PlatformAdmin = Depends(get_current_admin)) -> pm.PlatformAdmin:
        if not (admin.is_root or getattr(admin, flag)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return admin
    return dep
