"""Public side of the site pages: no login. Only published pages are visible; a draft answers 404."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import platform_models as pm
from app import platform_schemas as schemas
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/pages", tags=["pages"])


@router.get("/links", response_model=List[schemas.SitePageLink])
def page_links(db: Session = Depends(get_platform_db)):
    """The published pages that have a link in the footer and / or in the register form (in menu order)."""
    rows = (db.query(pm.SitePage)
            .filter(pm.SitePage.status == "published", (pm.SitePage.in_footer.is_(True)) | (pm.SitePage.in_register.is_(True)))
            .order_by(pm.SitePage.sort_order, pm.SitePage.id).all())
    return [schemas.SitePageLink(slug=p.slug, title_uk=p.title_uk or "", title_en=p.title_en or "",
                                 in_footer=p.in_footer, in_register=p.in_register) for p in rows]


@router.get("/{slug}", response_model=schemas.SitePagePublic)
def get_page(slug: str, db: Session = Depends(get_platform_db)):
    page = db.query(pm.SitePage).filter(pm.SitePage.slug == slug.lower(), pm.SitePage.status == "published").first()
    if page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    return schemas.SitePagePublic(slug=page.slug, title_uk=page.title_uk or "", title_en=page.title_en or "",
                                  content_uk=page.content_uk or "", content_en=page.content_en or "",
                                  updated_at=page.updated_at)
