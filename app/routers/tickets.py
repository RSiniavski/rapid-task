from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

HIERARCHY_ERRORS = {
    "parent_not_found": "Parent ticket not found in this project",
    "type_not_allowed": "This ticket type cannot be a child of the selected parent",
    "parent_is_self": "Ticket cannot be its own parent or ancestor",
    "subtask_type_not_allowed": "This subtask type is not allowed for the selected ticket type",
    "milestone_not_found": "Milestone not found in this project",
    "tag_not_found": "Tag not found in this project",
    "component_not_found": "Component not found in this project",
    "too_many_labels": "Too many tags or components (max 10 each)",
}


def _with_ancestors(ticket: models.Ticket) -> models.Ticket:
    """Додає до ORM-об'єкта список предків для response-схеми."""
    ticket.ancestors = crud.get_ancestors(ticket)
    return ticket


def _get_ticket_or_404(db: Session, ticket_id: int) -> models.Ticket:
    ticket = crud.get_ticket_by_id(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def _require_project_member(db: Session, project_id: int, user: models.User) -> models.ProjectRole:
    role = crud.get_member_role(db, project_id, user.id)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")
    return role


@router.post("/project/{project_id}", response_model=schemas.TicketResponse,
             status_code=status.HTTP_201_CREATED)
def create_ticket(
    project_id: int,
    payload: schemas.TicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # створення доступне будь-якому учаснику (усі 4 ролі)
    _require_project_member(db, project_id, current_user)

    user_ids = [payload.assignee_id, payload.tester_id] + [s.assignee_id for s in payload.subtasks]
    for uid in filter(None, user_ids):
        if not crud.is_assignable(db, project_id, uid):
            raise HTTPException(status_code=400, detail=f"User {uid} is not an active project member")

    try:
        ticket = crud.create_ticket(db, project, payload, current_user.id)
        return _with_ancestors(ticket)
    except ValueError as e:
        code = str(e)
        if code == "column_not_found":
            raise HTTPException(status_code=400, detail="Column not found in this project")
        if code in HIERARCHY_ERRORS:
            raise HTTPException(status_code=400, detail=HIERARCHY_ERRORS[code])
        raise


@router.get("/project/{project_id}", response_model=List[schemas.TicketResponse])
def list_project_tickets(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not crud.get_project(db, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    _require_project_member(db, project_id, current_user)
    return [_with_ancestors(t) for t in crud.get_project_tickets(db, project_id)]


@router.get("/key/{ticket_key}", response_model=schemas.TicketResponse)
def get_ticket_by_key(
    ticket_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket_by_key(db, ticket_key)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    _require_project_member(db, ticket.project_id, current_user)
    return _with_ancestors(ticket)


@router.get("/{ticket_id}", response_model=schemas.TicketResponse)
def get_ticket_by_id(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    _require_project_member(db, ticket.project_id, current_user)
    return _with_ancestors(ticket)


@router.patch("/{ticket_id}/column", response_model=schemas.TicketResponse)
def move_ticket(
    ticket_id: int,
    payload: schemas.TicketColumnUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    role = _require_project_member(db, ticket.project_id, current_user)
    if not crud.can_edit_ticket(db, ticket, current_user.id, role):
        raise HTTPException(status_code=403, detail="Not allowed to edit this ticket")

    update_payload = schemas.TicketUpdate(column_id=payload.column_id)
    try:
        updated = crud.update_ticket(db, ticket, update_payload, current_user.id)
        return _with_ancestors(updated)
    except ValueError as e:
        code = str(e)
        if code == "column_not_found":
            raise HTTPException(status_code=400, detail="Column not found in this project")
        if code in HIERARCHY_ERRORS:
            raise HTTPException(status_code=400, detail=HIERARCHY_ERRORS[code])
        raise


@router.patch("/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(
    ticket_id: int,
    payload: schemas.TicketUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    role = _require_project_member(db, ticket.project_id, current_user)
    if not crud.can_edit_ticket(db, ticket, current_user.id, role):
        raise HTTPException(status_code=403, detail="Not allowed to edit this ticket")

    if payload.assignee_id or payload.tester_id:
        for uid in filter(None, (payload.assignee_id, payload.tester_id)):
            if not crud.is_assignable(db, ticket.project_id, uid):
                raise HTTPException(status_code=400, detail=f"User {uid} is not an active project member")

    try:
        updated = crud.update_ticket(db, ticket, payload, current_user.id)
        return _with_ancestors(updated)
    except ValueError as e:
        code = str(e)
        if code == "column_not_found":
            raise HTTPException(status_code=400, detail="Column not found in this project")
        if code in HIERARCHY_ERRORS:
            raise HTTPException(status_code=400, detail=HIERARCHY_ERRORS[code])
        raise


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    role = _require_project_member(db, ticket.project_id, current_user)
    if not crud.can_delete_ticket(role):
        raise HTTPException(status_code=403, detail="Admin role required to delete tickets")
    crud.delete_ticket(db, ticket)
    return None
