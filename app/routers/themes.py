import json
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models
from app.theme_validation import validate_theme, MAX_JSON_BYTES

MAX_CUSTOM_THEMES_PER_USER = 20

router = APIRouter(prefix="/api/themes", tags=["Themes"])


def theme_to_dict(row: models.Theme) -> dict:
    data = json.loads(row.data)
    return {
        "id": row.id,
        "key": row.key,
        "name": row.name,
        "is_preset": row.is_preset,
        "created_by": row.created_by,
        "colors": data["colors"],
        "shadows": data["shadows"],
        "typography": data["typography"],
    }


@router.get("")
def list_themes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
) -> List[dict]:
    rows = (
        db.query(models.Theme)
        .filter(or_(models.Theme.is_preset.is_(True), models.Theme.created_by == current_user.id))
        .order_by(models.Theme.id)
        .all()
    )
    return [theme_to_dict(r) for r in rows]

@router.post("/import", status_code=status.HTTP_201_CREATED)
def import_theme(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if len(json.dumps(payload)) > MAX_JSON_BYTES:
        raise HTTPException(status_code=413, detail="Theme JSON is too large")
    errors = validate_theme(payload)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    count = db.query(models.Theme).filter(models.Theme.created_by == current_user.id).count()
    if count >= MAX_CUSTOM_THEMES_PER_USER:
        raise HTTPException(status_code=400, detail="Too many custom themes (max 20)")
    clean = {
        "colors": {k: v.strip() for k, v in payload["colors"].items()},
        "shadows": {k: v.strip() for k, v in payload["shadows"].items()},
        "typography": {k: v.strip() for k, v in payload["typography"].items()},
    }
    row = models.Theme(
        key=None, name=payload["name"].strip(), is_preset=False,
        data=json.dumps(clean), created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return theme_to_dict(row)