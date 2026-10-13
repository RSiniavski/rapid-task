from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _get_project_or_404(db: Session, project_id: int) -> models.Project:
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _require_member(db: Session, project_id: int, user: models.User) -> models.ProjectRole:
    role = crud.get_member_role(db, project_id, user.id)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")
    return role


def _require_admin(db: Session, project_id: int, user: models.User) -> models.ProjectRole:
    role = _require_member(db, project_id, user)
    if not crud.can_admin_project(role):
        raise HTTPException(status_code=403, detail="Admin role required")
    return role


@router.post("", response_model=schemas.ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if crud.get_project_by_key(db, payload.key):
        raise HTTPException(status_code=409, detail=f"Project key '{payload.key}' already exists")
    return crud.create_project(db, payload, current_user)


@router.get("", response_model=List[schemas.ProjectResponse])
def list_my_projects(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.get_user_projects(db, current_user.id)


@router.get("/dashboard", response_model=schemas.DashboardStats)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.get_dashboard_stats(db, current_user)


@router.get("/{project_id}", response_model=schemas.ProjectDetailResponse)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_member(db, project_id, current_user)
    return project


@router.patch("/{project_id}", response_model=schemas.ProjectResponse)
def update_project(
    project_id: int,
    payload: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    return crud.update_project(db, project, payload)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only project owner can delete it")
    crud.delete_project(db, project)
    return None


# --- MEMBERS ---
@router.get("/{project_id}/members", response_model=List[schemas.ProjectMemberResponse])
def list_members(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_member(db, project_id, current_user)
    return crud.get_project_members(db, project_id)


@router.post("/{project_id}/members", response_model=schemas.ProjectMemberResponse,
             status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: int,
    payload: schemas.MemberAdd,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    member = crud.add_project_member(db, project, payload)
    if member is None:
        raise HTTPException(status_code=404, detail="User not found or already a member")
    return member


@router.patch("/{project_id}/members/{user_id}", response_model=schemas.ProjectMemberResponse)
def update_member_role(
    project_id: int,
    user_id: int,
    payload: schemas.MemberUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    member = crud.update_project_member(db, project_id, user_id, payload.role)
    if member is None:
        raise HTTPException(status_code=400, detail="Member not found or owner role is fixed")
    return member


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    if not crud.remove_project_member(db, project_id, user_id):
        raise HTTPException(status_code=400, detail="Member not found or cannot remove owner")
    return None


# --- BOARD COLUMNS ---
@router.get("/{project_id}/columns", response_model=List[schemas.BoardColumnResponse])
def list_columns(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_member(db, project_id, current_user)
    return crud.get_project_columns(db, project_id)


@router.post("/{project_id}/columns", response_model=schemas.BoardColumnResponse,
             status_code=status.HTTP_201_CREATED)
def create_column(
    project_id: int,
    payload: schemas.ColumnCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    return crud.create_board_column(db, project, payload)


@router.patch("/{project_id}/columns/{column_id}", response_model=schemas.BoardColumnResponse)
def update_column(
    project_id: int,
    column_id: int,
    payload: schemas.ColumnUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    column = db.query(models.BoardColumn).filter(
        models.BoardColumn.id == column_id,
        models.BoardColumn.project_id == project_id,
    ).first()
    if not column:
        raise HTTPException(status_code=404, detail="Column not found")
    return crud.update_board_column(db, column, payload)


@router.delete("/{project_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    project_id: int,
    column_id: int,
    move_tickets_to: int = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_project_or_404(db, project_id)
    _require_admin(db, project_id, current_user)
    column = db.query(models.BoardColumn).filter(
        models.BoardColumn.id == column_id,
        models.BoardColumn.project_id == project_id,
    ).first()
    if not column:
        raise HTTPException(status_code=404, detail="Column not found")

    target = None
    if move_tickets_to is not None:
        target = db.query(models.BoardColumn).filter(
            models.BoardColumn.id == move_tickets_to,
            models.BoardColumn.project_id == project_id,
        ).first()
        if not target or target.id == column.id:
            raise HTTPException(status_code=400, detail="Invalid target column")

    if not crud.delete_board_column(db, column, target):
        raise HTTPException(
            status_code=409,
            detail="Column has tickets. Provide move_tickets_to to move them.",
        )
    return None


# --- STATS ---
@router.get("/{project_id}/stats", response_model=schemas.ProjectStats)
def project_stats(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    role = _require_member(db, project_id, current_user)
    return crud.get_project_stats(db, project, role)
