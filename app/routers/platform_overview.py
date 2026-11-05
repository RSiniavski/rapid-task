"""Platform Overview: global numbers and charts (permission: can_view_analytics; root has it always).
Read-only. The period is the last 7, 30 or 90 days (UTC days, today included)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import platform_models as pm
from app import platform_overview_logic as logic
from app import platform_schemas as schemas
from app.database import get_db
from app.platform_auth import require_permission

router = APIRouter(prefix="/api/platform/overview", tags=["platform"])
can_view_analytics = require_permission("can_view_analytics")


@router.get("", response_model=schemas.OverviewOut)
def get_overview(days: int = Query(30), admin: pm.PlatformAdmin = Depends(can_view_analytics), db: Session = Depends(get_db)):
    if days not in logic.PERIODS:
        raise HTTPException(status_code=422, detail="days must be 7, 30 or 90")
    return logic.build(db, days)
