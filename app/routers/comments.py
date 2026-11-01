"""Ticket comments. Every project member can read and write; the author edits his own comment;
the author or a project admin deletes it."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api", tags=["comments"])


def _ticket_and_role(db: Session, ticket_id: int, user: models.User):
    ticket = crud.get_ticket_by_id(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    role = crud.get_member_role(db, ticket.project_id, user.id)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")
    return ticket, role


def _comment_and_role(db: Session, comment_id: int, user: models.User):
    comment = crud.get_comment(db, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    ticket, role = _ticket_and_role(db, comment.ticket_id, user)
    return comment, role


@router.get("/tickets/{ticket_id}/comments", response_model=List[schemas.CommentResponse])
def list_comments(
    ticket_id: int,
    order: str = Query("asc", pattern="^(asc|desc)$", description="asc = oldest first, desc = newest first"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _ticket_and_role(db, ticket_id, current_user)
    return crud.list_comments(db, ticket_id, newest_first=(order == "desc"))


@router.post("/tickets/{ticket_id}/comments", response_model=schemas.CommentResponse,
             status_code=status.HTTP_201_CREATED)
def create_comment(
    ticket_id: int,
    payload: schemas.CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ticket, _ = _ticket_and_role(db, ticket_id, current_user)
    return crud.create_comment(db, ticket, current_user.id, payload.body)


@router.patch("/comments/{comment_id}", response_model=schemas.CommentResponse)
def update_comment(
    comment_id: int,
    payload: schemas.CommentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    comment, _ = _comment_and_role(db, comment_id, current_user)
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the author can edit a comment")
    return crud.update_comment(db, comment, current_user.id, payload.body)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    comment, role = _comment_and_role(db, comment_id, current_user)
    if comment.author_id != current_user.id and role != models.ProjectRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only the author or a project admin can delete a comment")
    crud.delete_comment(db, comment, current_user.id)
    return None
