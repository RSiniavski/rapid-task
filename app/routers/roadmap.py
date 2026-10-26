"""Roadmap API: віхи (macro-blocks), залежності між віхами/тікетами, позиції на полотні.

Права:
  * читати Roadmap може будь-який учасник проекту;
  * створювати/змінювати/видаляти віхи, залежності та розкладку — Admin і Editor;
  * призначення тікета на віху — через PATCH /api/tickets/{id} (`milestone_id`),
    тож діють звичайні правила редагування тікетів.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api/roadmap", tags=["roadmap"])

DEPENDENCY_ERRORS = {
    "self_dependency": "An item cannot depend on itself",
    "not_found": "Both items must exist in this project",
    "duplicate": "This dependency already exists",
    "cycle": "This dependency would create a cycle",
}
MILESTONE_ERRORS = {
    "invalid_dates": "Due date cannot be earlier than start date",
    "invalid_title": "Title cannot be empty",
    "auto_managed": "Status and progress are calculated automatically from the milestone's tickets",
    "use_close": "Use the Close action to finish a milestone",
    "closed": "The milestone is closed. Reopen it first",
    "already_closed": "The milestone is already closed",
    "not_closed": "The milestone is not closed",
    "active_tickets": "The milestone still has tickets that are not done",
}


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


def _require_planner(db: Session, project_id: int, user: models.User) -> models.ProjectRole:
    role = _require_member(db, project_id, user)
    if not crud.can_plan_roadmap(role):
        raise HTTPException(status_code=403, detail="Admin or Editor role required")
    return role


def _get_milestone_or_404(db: Session, milestone_id: int) -> models.Milestone:
    milestone = crud.get_milestone(db, milestone_id)
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return milestone


def _milestone_response(db: Session, project: models.Project, milestone_id: int) -> dict:
    """Віха з актуальними лічильниками й аналізом ризиків (з повного знімка Roadmap)."""
    for row in crud.build_roadmap(db, project)["milestones"]:
        if row["id"] == milestone_id:
            return row
    raise HTTPException(status_code=404, detail="Milestone not found")


@router.get("/project/{project_id}", response_model=schemas.RoadmapResponse)
def get_roadmap(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_member(db, project_id, current_user)
    crud.recalc_project_milestones(db, project_id)  # на випадок правок БД поза API
    return crud.build_roadmap(db, project)


@router.post("/project/{project_id}/milestones", response_model=schemas.MilestoneResponse,
             status_code=status.HTTP_201_CREATED)
def create_milestone(
    project_id: int,
    payload: schemas.MilestoneCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_planner(db, project_id, current_user)
    try:
        milestone = crud.create_milestone(db, project, payload)
    except ValueError as e:
        code = str(e)
        if code in MILESTONE_ERRORS:
            raise HTTPException(status_code=400, detail=MILESTONE_ERRORS[code])
        raise
    return _milestone_response(db, project, milestone.id)


@router.patch("/milestones/{milestone_id}", response_model=schemas.MilestoneResponse)
def update_milestone(
    milestone_id: int,
    payload: schemas.MilestoneUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    milestone = _get_milestone_or_404(db, milestone_id)
    _require_planner(db, milestone.project_id, current_user)
    project = _get_project_or_404(db, milestone.project_id)
    try:
        crud.update_milestone(db, milestone, payload)
    except ValueError as e:
        code = str(e)
        if code in MILESTONE_ERRORS:
            raise HTTPException(status_code=400, detail=MILESTONE_ERRORS[code])
        raise
    return _milestone_response(db, project, milestone_id)

def _require_admin(db: Session, project_id: int, user: models.User) -> None:
    role = _require_member(db, project_id, user)
    if role != models.ProjectRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin role required")


def _close_or_reopen(action, milestone_id: int, db: Session, user: models.User) -> dict:
    milestone = _get_milestone_or_404(db, milestone_id)
    _require_admin(db, milestone.project_id, user)
    project = _get_project_or_404(db, milestone.project_id)
    try:
        action(db, milestone)
    except ValueError as e:
        code = str(e)
        if code in MILESTONE_ERRORS:
            raise HTTPException(status_code=400, detail=MILESTONE_ERRORS[code])
        raise
    return _milestone_response(db, project, milestone_id)


@router.post("/milestones/{milestone_id}/close", response_model=schemas.MilestoneResponse)
def close_milestone(milestone_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.get_current_user)):
    return _close_or_reopen(crud.close_milestone, milestone_id, db, current_user)


@router.post("/milestones/{milestone_id}/reopen", response_model=schemas.MilestoneResponse)
def reopen_milestone(milestone_id: int, db: Session = Depends(get_db),
                     current_user: models.User = Depends(auth.get_current_user)):
    return _close_or_reopen(crud.reopen_milestone, milestone_id, db, current_user)

@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(
    milestone_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    milestone = _get_milestone_or_404(db, milestone_id)
    _require_planner(db, milestone.project_id, current_user)
    crud.delete_milestone(db, milestone)
    return None


@router.post("/project/{project_id}/dependencies", response_model=schemas.DependencyResponse,
             status_code=status.HTTP_201_CREATED)
def create_dependency(
    project_id: int,
    payload: schemas.DependencyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_planner(db, project_id, current_user)
    try:
        dependency = crud.create_dependency(db, project, payload)
    except ValueError as e:
        code = str(e)
        if code in DEPENDENCY_ERRORS:
            raise HTTPException(status_code=400, detail=DEPENDENCY_ERRORS[code])
        raise
    return _dependency_response(db, project, dependency.id)


@router.patch("/dependencies/{dependency_id}", response_model=schemas.DependencyResponse)
def update_dependency(
    dependency_id: int,
    payload: schemas.DependencyUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dependency = crud.get_dependency(db, dependency_id)
    if not dependency:
        raise HTTPException(status_code=404, detail="Dependency not found")
    _require_planner(db, dependency.project_id, current_user)
    project = _get_project_or_404(db, dependency.project_id)
    crud.update_dependency(db, dependency, payload)
    return _dependency_response(db, project, dependency_id)


@router.delete("/dependencies/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dependency(
    dependency_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dependency = crud.get_dependency(db, dependency_id)
    if not dependency:
        raise HTTPException(status_code=404, detail="Dependency not found")
    _require_planner(db, dependency.project_id, current_user)
    crud.delete_dependency(db, dependency)
    return None


@router.put("/project/{project_id}/layout")
def save_layout(
    project_id: int,
    payload: schemas.LayoutUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = _get_project_or_404(db, project_id)
    _require_planner(db, project_id, current_user)
    return {"saved": crud.save_layout(db, project, payload.items)}


def _dependency_response(db: Session, project: models.Project, dependency_id: int) -> dict:
    for row in crud.build_roadmap(db, project)["dependencies"]:
        if row["id"] == dependency_id:
            return row
    raise HTTPException(status_code=404, detail="Dependency not found")
