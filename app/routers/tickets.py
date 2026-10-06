from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import schemas, crud, auth, models

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])

@router.get("", response_model=List[schemas.TicketResponse])
def get_tickets(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return crud.get_tickets(db)

@router.post("", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(
    ticket: schemas.TicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return crud.create_ticket(db=db, ticket=ticket, reporter_id=current_user.id)

@router.put("/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(
    ticket_id: int,
    payload: schemas.TicketUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    updated_ticket = crud.update_ticket(
        db=db,
        ticket_id=ticket_id,
        ticket_data=payload,
        user_id=current_user.id
    )
    if not updated_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return updated_ticket


@router.patch("/{ticket_id}/status", response_model=schemas.TicketResponse)
def update_status(
    ticket_id: int,
    payload: schemas.TicketUpdateStatus,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    updated_ticket = crud.update_ticket_status(
        db=db,
        ticket_id=ticket_id,
        new_status=payload.status,
        user_id=current_user.id
    )
    if not updated_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return updated_ticket

@router.get("/key/{ticket_key}", response_model=schemas.TicketResponse)
def get_ticket_by_key(
    ticket_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    ticket = db.query(models.Ticket).filter(models.Ticket.key == ticket_key).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket

@router.get("/{ticket_id}", response_model=schemas.TicketResponse)
def get_ticket_by_id(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket

@router.delete("/key/{ticket_key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket_by_key(
    ticket_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    success = crud.delete_ticket_by_key(db=db, ticket_key=ticket_key)
    if not success:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return None

@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    success = crud.delete_ticket(db=db, ticket_id=ticket_id)
    if not success:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return None
