import json
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models

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