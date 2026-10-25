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


def _list(db: Session, model, project_id: int):
    return db.query(model).filter(model.project_id == project_id).order_by(func.lower(model.name)).all()


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


@router.get("/tags", response_model=List[schemas.LabelResponse])
def list_tags(project_id: int, db: Session = Depends(get_db),
              current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _list(db, models.Tag, project_id)


@router.post("/tags", response_model=schemas.LabelResponse, status_code=status.HTTP_201_CREATED)
def create_tag(project_id: int, payload: schemas.TagCreate, db: Session = Depends(get_db),
               current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _create(db, models.Tag, project_id, payload.name, "Tag")


@router.get("/components", response_model=List[schemas.LabelResponse])
def list_components(project_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _list(db, models.Component, project_id)


@router.post("/components", response_model=schemas.LabelResponse, status_code=status.HTTP_201_CREATED)
def create_component(project_id: int, payload: schemas.ComponentCreate, db: Session = Depends(get_db),
                     current_user: models.User = Depends(auth.get_current_user)):
    _member_or_error(db, project_id, current_user)
    return _create(db, models.Component, project_id, payload.name, "Component")