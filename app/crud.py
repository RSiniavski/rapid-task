from sqlalchemy.orm import Session
from app import models, schemas, auth


# --- USER CRUD ---
def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, user: schemas.UserCreate):
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        hashed_password=hashed_password,
        full_name=user.full_name
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_users(db: Session):
    return db.query(models.User).all()


# --- TICKET CRUD ---
def generate_ticket_key(db: Session) -> str:
    count = db.query(models.Ticket).count()
    return f"RT-{count + 1}"


def get_tickets(db: Session):
    return db.query(models.Ticket).all()


def create_ticket(db: Session, ticket: schemas.TicketCreate, reporter_id: int):
    ticket_key = generate_ticket_key(db)
    db_ticket = models.Ticket(
        key=ticket_key,
        title=ticket.title,
        description=ticket.description,
        type=ticket.type,
        assignee_id=ticket.assignee_id,
        reporter_id=reporter_id,
        status=models.TicketStatus.TODO
    )
    db.add(db_ticket)
    db.commit()
    db.refresh(db_ticket)

    # Запис історії про створення
    log_history(db, db_ticket.id, reporter_id, "status", None, db_ticket.status.value)
    return db_ticket


def update_ticket(db: Session, ticket_id: int, ticket_data: schemas.TicketUpdate, user_id: int):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        return None

    # Словник полів для перевірки змін
    update_data = ticket_data.dict(exclude_unset=True)

    for field, new_value in update_data.items():
        old_value = getattr(ticket, field)

        # Приводимо Enum до рядка для запису в історію, якщо потрібно
        old_val_str = old_value.value if hasattr(old_value, 'value') else str(
            old_value) if old_value is not None else None
        new_val_str = new_value.value if hasattr(new_value, 'value') else str(
            new_value) if new_value is not None else None

        if old_val_str != new_val_str:
            # Оновлюємо поле
            setattr(ticket, field, new_value)

            # Записуємо зміну в історію
            history_entry = models.TicketHistory(
                ticket_id=ticket.id,
                user_id=user_id,
                field_changed=field,
                old_value=old_val_str,
                new_value=new_val_str
            )
            db.add(history_entry)

    db.commit()
    db.refresh(ticket)
    return ticket


def update_ticket_status(db: Session, ticket_id: int, new_status: models.TicketStatus, user_id: int):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        return None

    old_status = db_ticket.status.value
    if old_status != new_status.value:
        db_ticket.status = new_status
        log_history(db, ticket_id, user_id, "status", old_status, new_status.value)
        db.commit()
        db.refresh(db_ticket)

    return db_ticket


# --- HISTORY LOGGING ---
def log_history(db: Session, ticket_id: int, user_id: int, field: str, old_val: str, new_val: str):
    history_entry = models.TicketHistory(
        ticket_id=ticket_id,
        user_id=user_id,
        field_changed=field,
        old_value=old_val,
        new_value=new_val
    )
    db.add(history_entry)
    db.commit()