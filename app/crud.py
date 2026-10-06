from sqlalchemy.orm import Session
from typing import Optional
from app import models, schemas, auth


# --- USER CRUD ---
def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()


def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()


def create_user(db: Session, user: schemas.UserCreate):
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        hashed_password=hashed_password,
        full_name=user.full_name,
        is_active=True
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_users(db: Session):
    return db.query(models.User).all()


def deactivate_user(db: Session, user_id: int) -> Optional[models.User]:
    """
    М'яке видалення / деактивація:
    Зберігає напрацьовані тікети та історію дій користувача.
    Додає примітку (Deactivated) до імені, вимикає активність та знімає активні призначення.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return None

    # Додаємо примітку до імені, якщо ще не додано
    if not user.full_name.endswith("(Deactivated)"):
        user.full_name = f"{user.full_name} (Deactivated)"

    user.is_active = False

    # Знімаємо виконавця з призначених відкритих тікетів
    db.query(models.Ticket).filter(models.Ticket.assignee_id == user_id).update(
        {models.Ticket.assignee_id: None},
        synchronize_session=False
    )

    db.commit()
    db.refresh(user)
    return user


def hard_delete_user(db: Session, user_id: int) -> bool:
    """
    Повне тестове видалення (каскадне очищення для автотестів):
    Видаляє тестового користувача, усі створені ним тікети, їхню історію та записи дій.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return False

    # 1. Unassign user from any tickets they are assigned to
    db.query(models.Ticket).filter(models.Ticket.assignee_id == user_id).update(
        {models.Ticket.assignee_id: None},
        synchronize_session=False
    )

    # 2. Delete history and tickets reported by this user
    reported_ticket_ids = [t[0] for t in db.query(models.Ticket.id).filter(models.Ticket.reporter_id == user_id).all()]
    if reported_ticket_ids:
        db.query(models.TicketHistory).filter(models.TicketHistory.ticket_id.in_(reported_ticket_ids)).delete(
            synchronize_session=False
        )
        db.query(models.Ticket).filter(models.Ticket.id.in_(reported_ticket_ids)).delete(
            synchronize_session=False
        )

    # 3. Delete any remaining ticket history entries created by this user
    db.query(models.TicketHistory).filter(models.TicketHistory.user_id == user_id).delete(
        synchronize_session=False
    )

    # 4. Delete the user
    db.delete(user)
    db.commit()
    return True


def delete_user(db: Session, user_id: int, hard_delete: bool = False) -> bool:
    """
    Універсальна функція видалення:
    - hard_delete=False (за замовчуванням): деактивація зі збереженням історії та тікетів.
    - hard_delete=True: повне каскадне видалення для автотестів.
    """
    if hard_delete:
        return hard_delete_user(db, user_id)
    else:
        user = deactivate_user(db, user_id)
        return user is not None


def delete_user_by_email(db: Session, email: str, hard_delete: bool = False) -> bool:
    user = get_user_by_email(db, email)
    if not user:
        return False
    return delete_user(db, user.id, hard_delete=hard_delete)


# --- TICKET CRUD ---
def generate_ticket_key(db: Session) -> str:
    count = db.query(models.Ticket).count()
    return f"RT-{count + 1}"


def get_tickets(db: Session):
    return db.query(models.Ticket).all()


def get_ticket_by_id(db: Session, ticket_id: int):
    return db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()


def get_ticket_by_key(db: Session, ticket_key: str):
    return db.query(models.Ticket).filter(models.Ticket.key == ticket_key).first()


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


def delete_ticket(db: Session, ticket_id: int) -> bool:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        return False
    db.delete(ticket)
    db.commit()
    return True


def delete_ticket_by_key(db: Session, ticket_key: str) -> bool:
    ticket = db.query(models.Ticket).filter(models.Ticket.key == ticket_key).first()
    if not ticket:
        return False
    db.delete(ticket)
    db.commit()
    return True


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
