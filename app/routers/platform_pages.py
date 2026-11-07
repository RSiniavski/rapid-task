"""Site pages in the platform admin tool (permission: can_manage_pages, root has it always).
List, read, create (always as a draft), edit, publish / unpublish, delete. Every change goes to the audit log.
  draft     = not public
  published = public at /p/<slug>; a change of a published page is live at once
A system page (Donate) cannot be deleted and keeps its address."""
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import platform_logic as logic
from app import platform_models as pm
from app import platform_pages_logic as pages
from app import platform_schemas as schemas
from app.platform_auth import require_permission
from app.platform_db import get_platform_db

router = APIRouter(prefix="/api/platform/pages", tags=["platform"])
can_manage_pages = require_permission("can_manage_pages")

TEXT_FIELDS = ("slug", "title_uk", "title_en", "content_uk", "content_en", "in_footer", "in_register", "sort_order")


def _get(db: Session, page_id: int) -> pm.SitePage:
    page = db.get(pm.SitePage, page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


def _stamp(page: pm.SitePage, admin: pm.PlatformAdmin) -> None:
    page.updated_at = datetime.utcnow()
    page.updated_by = admin.username


@router.get("", response_model=List[schemas.SitePageListItem])
def list_pages(admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    rows = db.query(pm.SitePage).order_by(pm.SitePage.sort_order, pm.SitePage.id).all()
    return [pages.to_list_item(p) for p in rows]


@router.get("/{page_id}", response_model=schemas.SitePageOut)
def get_page(page_id: int, admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    return pages.to_out(_get(db, page_id))


@router.post("", response_model=schemas.SitePageOut, status_code=status.HTTP_201_CREATED)
def create_page(body: schemas.SitePageCreate, request: Request,
                admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    if db.query(pm.SitePage).filter(pm.SitePage.slug == body.slug).first():
        raise HTTPException(status_code=409, detail="This address is already used by another page")
    page = pm.SitePage(**body.model_dump(), status="draft", is_system=False)
    _stamp(page, admin)
    db.add(page)
    try:
        db.flush()
    except IntegrityError:                                    # two requests with the same address at once
        db.rollback()
        raise HTTPException(status_code=409, detail="This address is already used by another page")
    logic.write_audit(db, "page_created", actor=admin, target_type="page", target_id=page.id,
                      target_name=page.slug, ip=logic.client_ip(request),
                      details={"title": page.title_en or page.title_uk})
    db.commit()
    db.refresh(page)
    return pages.to_out(page)


@router.patch("/{page_id}", response_model=schemas.SitePageOut)
def update_page(page_id: int, body: schemas.SitePageUpdate, request: Request,
                admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    page = _get(db, page_id)
    changes = {k: v for k, v in body.model_dump(exclude_none=True).items() if getattr(page, k) != v}
    if "slug" in changes:
        if page.is_system:
            raise HTTPException(status_code=409, detail="The address of a system page cannot be changed")
        if db.query(pm.SitePage).filter(pm.SitePage.slug == changes["slug"], pm.SitePage.id != page.id).first():
            raise HTTPException(status_code=409, detail="This address is already used by another page")
    if not changes:
        return pages.to_out(page)
    old_slug = page.slug
    for field, value in changes.items():
        setattr(page, field, value)
    if not ((page.title_uk or "").strip() or (page.title_en or "").strip()):
        db.rollback()
        raise HTTPException(status_code=422, detail="The page needs a title (Ukrainian or English)")
    if page.status == "published":                            # a live page must stay publishable
        problem = pages.publish_problem(page)
        if problem:
            db.rollback()
            raise HTTPException(status_code=422, detail=problem + ". Unpublish the page first, or keep some text")
    _stamp(page, admin)
    details = {"changed": sorted(changes)}
    if "slug" in changes:
        details["old_slug"] = old_slug
    logic.write_audit(db, "page_updated", actor=admin, target_type="page", target_id=page.id,
                      target_name=page.slug, ip=logic.client_ip(request), details=details)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This address is already used by another page")
    db.refresh(page)
    return pages.to_out(page)


@router.post("/{page_id}/publish", response_model=schemas.SitePageOut)
def publish_page(page_id: int, request: Request,
                 admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    page = _get(db, page_id)
    if page.status == "published":
        raise HTTPException(status_code=409, detail="The page is already published")
    problem = pages.publish_problem(page)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    page.status = "published"
    _stamp(page, admin)
    logic.write_audit(db, "page_published", actor=admin, target_type="page", target_id=page.id,
                      target_name=page.slug, ip=logic.client_ip(request))
    db.commit()
    db.refresh(page)
    return pages.to_out(page)


@router.post("/{page_id}/unpublish", response_model=schemas.SitePageOut)
def unpublish_page(page_id: int, request: Request,
                   admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    page = _get(db, page_id)
    if page.status != "published":
        raise HTTPException(status_code=409, detail="The page is not published")
    page.status = "draft"
    _stamp(page, admin)
    logic.write_audit(db, "page_unpublished", actor=admin, target_type="page", target_id=page.id,
                      target_name=page.slug, ip=logic.client_ip(request))
    db.commit()
    db.refresh(page)
    return pages.to_out(page)


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_page(page_id: int, request: Request,
                admin: pm.PlatformAdmin = Depends(can_manage_pages), db: Session = Depends(get_platform_db)):
    page = _get(db, page_id)
    if page.is_system:
        raise HTTPException(status_code=409, detail="A system page cannot be deleted. Unpublish it instead")
    logic.write_audit(db, "page_deleted", actor=admin, target_type="page", target_id=page.id,
                      target_name=page.slug, ip=logic.client_ip(request),
                      details={"title": page.title_en or page.title_uk, "was_published": page.status == "published"})
    db.delete(page)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
