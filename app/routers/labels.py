from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api/projects/{project_id}", tags=["Tags and components"])


def _member_or_error(db: Session, project_id: int, user: models.User) -> None:
    if not crud.get_project(db, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if crud.get_member_role(db, project_id, user.id) is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")


def _require_admin(db: Session, project_id: int, user: models.User) -> None:
    _member_or_error(db, project_id, user)
    if crud.get_member_role(db, project_id, user.id) != models.ProjectRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin role required")


# kind -> (model, link table, link column, ticket relationship name, history field)
KINDS = {
    "tag": (models.Tag, models.TicketTag, models.TicketTag.tag_id, "tags", "tags", "Tag"),
    "component": (models.Component, models.TicketComponent, models.TicketComponent.component_id,
                  "components", "components", "Component"),
}


def _list(db: Session, kind: str, project_id: int):
    """Labels of the project, each with the number of tickets that use it."""
    model, link, link_col = KINDS[kind][:3]
    counts = dict(db.query(link_col, func.count(link.ticket_id)).group_by(link_col).all())
    rows = db.query(model).filter(model.project_id == project_id).order_by(func.lower(model.name)).all()
    return [{"id": r.id, "name": r.name, "ticket_count": counts.get(r.id, 0)} for r in rows]


def _get_label(db: Session, kind: str, project_id: int, label_id: int):
    model, what = KINDS[kind][0], KINDS[kind][5]
    row = db.query(model).filter(model.id == label_id, model.project_id == project_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return row


def _tickets_with(db: Session, kind: str, label_id: int):
    link, link_col = KINDS[kind][1], KINDS[kind][2]
    ids = [r[0] for r in db.query(link.ticket_id).filter(link_col == label_id).all()]
    return db.query(models.Ticket).filter(models.Ticket.id.in_(ids)).all() if ids else []


def _names(ticket, rel: str, replace=None, drop=None) -> str:
    out = []
    for x in getattr(ticket, rel):
        if drop is not None and x.id == drop:
            continue
        out.append(replace[1] if replace and x.id == replace[0] else x.name)
    return ", ".join(out)


def _rename(db: Session, kind: str, project_id: int, label_id: int, name: str, user: models.User):
    model, what = KINDS[kind][0], KINDS[kind][5]
    rel, field = KINDS[kind][3], KINDS[kind][4]
    row = _get_label(db, kind, project_id, label_id)
    clash = db.query(model).filter(
        model.project_id == project_id, model.id != row.id,
        func.lower(model.name) == name.lower()).first()
    if clash:
        raise HTTPException(status_code=409, detail=f"{what} '{clash.name}' already exists")
    if row.name != name:
        for t in _tickets_with(db, kind, row.id):
            crud.log_history(db, t.id, user.id, field, _names(t, rel), _names(t, rel, replace=(row.id, name)))
        row.name = name
        db.commit()
        db.refresh(row)
    return row


def _delete(db: Session, kind: str, project_id: int, label_id: int, user: models.User) -> None:
    model = KINDS[kind][0]
    link, link_col = KINDS[kind][1], KINDS[kind][2]
    rel, field = KINDS[kind][3], KINDS[kind][4]
    row = _get_label(db, kind, project_id, label_id)
    for t in _tickets_with(db, kind, row.id):
        crud.log_history(db, t.id, user.id, field, _names(t, rel), _names(t, rel, drop=row.id) or None)
    db.query(link).filter(link_col == row.id).delete(synchronize_session=False)
    db.query(model).filter(model.id == row.id).delete(synchronize_session=False)
    db.commit()


def _create(db: Session, model, project_id: int, name: str, what: str):
    exists = db.query(model).filter(
        model.project_id == project_id, func.lower(model.name) == name.lower()).first()
    if exists:
        raise HTTPException(status_code=409, detail=f"{what} '{exists.name}' already exists")
    row = model(project_id=project_id, name=name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/tags", response_model=List[schemas.LabelUsageResponse])
def list_tags(project_id: int, db: Session = Depends(get_db),
              current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _list(db, "tag", project_id)


@router.post("/tags", response_model=schemas.LabelResponse, status_code=status.HTTP_201_CREATED)
def create_tag(project_id: int, payload: schemas.TagCreate, db: Session = Depends(get_db),
               current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _create(db, models.Tag, project_id, payload.name, "Tag")


@router.get("/components", response_model=List[schemas.LabelUsageResponse])
def list_components(project_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _list(db, "component", project_id)


@router.post("/components", response_model=schemas.LabelResponse, status_code=status.HTTP_201_CREATED)
def create_component(project_id: int, payload: schemas.ComponentCreate, db: Session = Depends(get_db),
                     current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _create(db, models.Component, project_id, payload.name, "Component")


@router.patch("/tags/{tag_id}", response_model=schemas.LabelResponse)
def rename_tag(project_id: int, tag_id: int, payload: schemas.TagRename, db: Session = Depends(get_db),
               current_user: models.User = Depends(auth.get_current_user)):
    _require_admin(db, project_id, current_user)
    return _rename(db, "tag", project_id, tag_id, payload.name, current_user)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(project_id: int, tag_id: int, db: Session = Depends(get_db),
               current_user: models.User = Depends(auth.get_current_user)):
    _require_admin(db, project_id, current_user)
    _delete(db, "tag", project_id, tag_id, current_user)


@router.patch("/components/{component_id}", response_model=schemas.LabelResponse)
def rename_component(project_id: int, component_id: int, payload: schemas.ComponentRename,
                     db: Session = Depends(get_db),
                     current_user: models.User = Depends(auth.get_current_user)):
    _require_admin(db, project_id, current_user)
    return _rename(db, "component", project_id, component_id, payload.name, current_user)


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_component(project_id: int, component_id: int, db: Session = Depends(get_db),
                     current_user: models.User = Depends(auth.get_current_user)):
    _require_admin(db, project_id, current_user)
    _delete(db, "component", project_id, component_id, current_user)
