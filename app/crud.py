from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from app import models, schemas, auth, files


# --- PERMISSIONS ---
def get_member_role(db: Session, project_id: int, user_id: int) -> Optional[models.ProjectRole]:
    member = db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project_id,
        models.ProjectMember.user_id == user_id,
    ).first()
    return member.role if member else None


def can_admin_project(role: Optional[models.ProjectRole]) -> bool:
    return role == models.ProjectRole.ADMIN


def can_delete_ticket(role: Optional[models.ProjectRole]) -> bool:
    # Editor — все, крім видалення; Contributor/Reporter — без видалення
    return role == models.ProjectRole.ADMIN


def can_edit_ticket(db: Session, ticket: models.Ticket, user_id: int,
                    role: Optional[models.ProjectRole]) -> bool:
    if role in (models.ProjectRole.ADMIN, models.ProjectRole.EDITOR):
        return True
    if role == models.ProjectRole.CONTRIBUTOR:
        # свої тікети + ті, де користувач assignee / tester / reporter
        return user_id in (ticket.reporter_id, ticket.assignee_id, ticket.tester_id)
    return False


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


def update_profile(db: Session, user: models.User, payload: schemas.ProfileUpdate) -> models.User:
    data = payload.dict(exclude_unset=True)
    if "full_name" in data and data["full_name"] is not None:
        user.full_name = data["full_name"].strip()
    if "position" in data:
        position = (data["position"] or "").strip()
        user.position = position or None
    db.commit()
    db.refresh(user)
    return user


def set_user_avatar(db: Session, user: models.User, stored_name: Optional[str]) -> models.User:
    old = user.avatar_path
    user.avatar_path = stored_name
    db.commit()
    db.refresh(user)
    if old and old != stored_name:
        files.delete_stored(old)
    return user


def deactivate_user(db: Session, user_id: int) -> Optional[models.User]:
    """
    М'яке видалення / деактивація:
    Зберігає напрацьовані тікети та історію дій користувача.
    Додає примітку (Deactivated) до імені, вимикає активність та знімає активні призначення.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return None

    if not user.full_name.endswith("(Deactivated)"):
        user.full_name = f"{user.full_name} (Deactivated)"

    user.is_active = False

    db.query(models.Ticket).filter(models.Ticket.assignee_id == user_id).update(
        {models.Ticket.assignee_id: None},
        synchronize_session=False
    )
    db.query(models.Ticket).filter(models.Ticket.tester_id == user_id).update(
        {models.Ticket.tester_id: None},
        synchronize_session=False
    )

    db.commit()
    db.refresh(user)
    return user


def hard_delete_user(db: Session, user_id: int) -> bool:
    """
    Повне тестове видалення (каскадне очищення для автотестів).
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return False

    # Знімаємо призначення з чужих тікетів
    db.query(models.Ticket).filter(models.Ticket.assignee_id == user_id).update(
        {models.Ticket.assignee_id: None}, synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.tester_id == user_id).update(
        {models.Ticket.tester_id: None}, synchronize_session=False)

    # Тікети, створені користувачем: історія + самі тікети
    reported_ids = [t[0] for t in db.query(models.Ticket.id)
                    .filter(models.Ticket.reporter_id == user_id).all()]
    if reported_ids:
        purge_ticket_attachments(db, reported_ids)
        db.query(models.TicketHistory).filter(
            models.TicketHistory.ticket_id.in_(reported_ids)).delete(synchronize_session=False)
        db.query(models.Ticket).filter(models.Ticket.id.in_(reported_ids)).delete(
            synchronize_session=False)

    # Історія, створена користувачем у чужих тікетах
    db.query(models.TicketHistory).filter(
        models.TicketHistory.user_id == user_id).delete(synchronize_session=False)

    # Учасництво в проектах
    db.query(models.ProjectMember).filter(
        models.ProjectMember.user_id == user_id).delete(synchronize_session=False)

    # Проекти, де користувач власник: чистимо вміст і видаляємо проекти
    owned_projects = db.query(models.Project).filter(models.Project.owner_id == user_id).all()
    for project in owned_projects:
        ticket_ids = [t[0] for t in db.query(models.Ticket.id)
                      .filter(models.Ticket.project_id == project.id).all()]
        purge_project_orphan_attachments(db, project.id)
        if ticket_ids:
            db.query(models.TicketHistory).filter(
                models.TicketHistory.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
            db.query(models.Ticket).filter(models.Ticket.id.in_(ticket_ids)).delete(
                synchronize_session=False)
        db.query(models.BoardColumn).filter(
            models.BoardColumn.project_id == project.id).delete(synchronize_session=False)
        db.query(models.ProjectMember).filter(
            models.ProjectMember.project_id == project.id).delete(synchronize_session=False)
        db.delete(project)

    avatar = user.avatar_path
    db.delete(user)
    db.commit()
    files.delete_stored(avatar)
    return True


def delete_user(db: Session, user_id: int, hard_delete: bool = False) -> bool:
    if hard_delete:
        return hard_delete_user(db, user_id)
    user = deactivate_user(db, user_id)
    return user is not None


def delete_user_by_email(db: Session, email: str, hard_delete: bool = False) -> bool:
    user = get_user_by_email(db, email)
    if not user:
        return False
    return delete_user(db, user.id, hard_delete=hard_delete)


# --- ATTACHMENTS ---
def get_attachment(db: Session, attachment_id: int) -> Optional[models.TicketAttachment]:
    return db.query(models.TicketAttachment).filter(
        models.TicketAttachment.id == attachment_id).first()


def create_attachment(db: Session, project_id: int, ticket_id: Optional[int], uploader_id: int,
                      filename: str, stored_name: str, content_type: str,
                      size: int) -> models.TicketAttachment:
    attachment = models.TicketAttachment(
        project_id=project_id, ticket_id=ticket_id, uploader_id=uploader_id,
        filename=filename, stored_name=stored_name,
        content_type=content_type, size=size,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


def delete_attachment(db: Session, attachment: models.TicketAttachment) -> None:
    stored = attachment.stored_name
    db.delete(attachment)
    db.commit()
    files.delete_stored(stored)


def purge_ticket_attachments(db: Session, ticket_ids: List[int]) -> None:
    """Видаляє вкладення тікетів (рядки + файли). Без commit — викликає зовнішній код."""
    if not ticket_ids:
        return
    rows = db.query(models.TicketAttachment).filter(
        models.TicketAttachment.ticket_id.in_(ticket_ids)).all()
    for row in rows:
        files.delete_stored(row.stored_name)
        db.delete(row)
    db.flush()


def purge_project_orphan_attachments(db: Session, project_id: int) -> None:
    rows = db.query(models.TicketAttachment).filter(
        models.TicketAttachment.project_id == project_id).all()
    for row in rows:
        files.delete_stored(row.stored_name)
        db.delete(row)
    db.flush()


# --- PROJECT CRUD ---
DEFAULT_COLUMNS = [
    ("Open", False),
    ("ToDo", False),
    ("In Progress", False),
    ("Ready For Testing", False),
    ("Testing", False),
    ("Ready for Deploy", False),
    ("Deployed", False),
    ("Done", True),
]


def get_project(db: Session, project_id: int) -> Optional[models.Project]:
    return db.query(models.Project).filter(models.Project.id == project_id).first()


def get_project_by_key(db: Session, key: str) -> Optional[models.Project]:
    return db.query(models.Project).filter(models.Project.key == key).first()


def get_user_projects(db: Session, user_id: int) -> List[models.Project]:
    return db.query(models.Project).join(models.ProjectMember).filter(
        models.ProjectMember.user_id == user_id
    ).order_by(models.Project.created_at).all()


def create_project(db: Session, payload: schemas.ProjectCreate, owner: models.User) -> models.Project:
    project = models.Project(
        name=payload.name,
        key=payload.key,
        project_type=payload.project_type,
        language=payload.language,
        owner_id=owner.id,
        ticket_seq=0,
    )
    db.add(project)
    db.flush()  # отримати project.id для зв'язків

    for position, (name, is_done) in enumerate(DEFAULT_COLUMNS):
        db.add(models.BoardColumn(
            project_id=project.id, name=name, position=position, is_done=is_done
        ))

    db.add(models.ProjectMember(
        project_id=project.id, user_id=owner.id, role=models.ProjectRole.ADMIN
    ))

    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, project: models.Project,
                   payload: schemas.ProjectUpdate) -> models.Project:
    data = payload.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project: models.Project) -> None:
    # Явне каскадне прибирання (SQLite без PRAGMA foreign_keys)
    ticket_ids = [t[0] for t in db.query(models.Ticket.id)
                  .filter(models.Ticket.project_id == project.id).all()]
    purge_project_orphan_attachments(db, project.id)
    if ticket_ids:
        db.query(models.TicketHistory).filter(
            models.TicketHistory.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
        db.query(models.Ticket).filter(models.Ticket.id.in_(ticket_ids)).delete(
            synchronize_session=False)
    db.query(models.BoardColumn).filter(
        models.BoardColumn.project_id == project.id).delete(synchronize_session=False)
    db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project.id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()


# --- MEMBERS ---
def get_project_members(db: Session, project_id: int) -> List[models.ProjectMember]:
    return db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project_id
    ).all()


def add_project_member(db: Session, project: models.Project,
                       payload: schemas.MemberAdd) -> Optional[models.ProjectMember]:
    if payload.user_id is not None:
        user = get_user_by_id(db, payload.user_id)
    elif payload.email is not None:
        user = get_user_by_email(db, payload.email)
    else:
        return None
    if not user:
        return None

    existing = db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project.id,
        models.ProjectMember.user_id == user.id,
    ).first()
    if existing:
        return None  # вже учасник

    member = models.ProjectMember(
        project_id=project.id, user_id=user.id, role=payload.role
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_project_member(db: Session, project_id: int, user_id: int,
                          role: models.ProjectRole) -> Optional[models.ProjectMember]:
    member = db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project_id,
        models.ProjectMember.user_id == user_id,
    ).first()
    if not member:
        return None
    project = get_project(db, project_id)
    if project and member.user_id == project.owner_id:
        return None  # роль власника незмінна
    member.role = role
    db.commit()
    db.refresh(member)
    return member


def remove_project_member(db: Session, project_id: int, user_id: int) -> bool:
    project = get_project(db, project_id)
    if project and user_id == project.owner_id:
        return False  # власника не видаляємо
    member = db.query(models.ProjectMember).filter(
        models.ProjectMember.project_id == project_id,
        models.ProjectMember.user_id == user_id,
    ).first()
    if not member:
        return False
    db.delete(member)
    db.commit()
    return True


# --- BOARD COLUMNS ---
def get_project_columns(db: Session, project_id: int) -> List[models.BoardColumn]:
    return db.query(models.BoardColumn).filter(
        models.BoardColumn.project_id == project_id
    ).order_by(models.BoardColumn.position).all()


def create_board_column(db: Session, project: models.Project,
                        payload: schemas.ColumnCreate) -> models.BoardColumn:
    columns = get_project_columns(db, project.id)
    position = payload.position if payload.position is not None else len(columns)
    # розсуваємо позиції, якщо вставляємо в середину
    for col in columns:
        if col.position >= position:
            col.position += 1
    column = models.BoardColumn(
        project_id=project.id, name=payload.name, position=position,
        is_done=False,
    )
    db.add(column)
    db.commit()
    db.refresh(column)
    return column


def update_board_column(db: Session, column: models.BoardColumn,
                        payload: schemas.ColumnUpdate) -> models.BoardColumn:
    data = payload.dict(exclude_unset=True)

    if "position" in data and data["position"] != column.position:
        new_pos = data.pop("position")
        project_columns = get_project_columns(db, column.project_id)
        others = [c for c in project_columns if c.id != column.id]
        others = [c for c in others if c.position < new_pos] + \
                 [c for c in others if c.position >= new_pos]
        # переставляємо: ті, що між старою і новою позиціями, зсуваються
        for col in others:
            if column.position < new_pos and column.position < col.position <= new_pos:
                col.position -= 1
            elif column.position > new_pos and new_pos <= col.position < column.position:
                col.position += 1
        column.position = new_pos

    if "name" in data and data["name"] is not None:
        column.name = data["name"]
    if "is_done" in data and data["is_done"] is not None:
        column.is_done = data["is_done"]
        if column.is_done:
            # всі тікети в цій колонці вважаються закритими
            now = datetime.utcnow()
            for ticket in column.tickets:
                if not ticket.closed_at:
                    ticket.closed_at = now
        else:
            for ticket in column.tickets:
                ticket.closed_at = None

    db.commit()
    db.refresh(column)
    return column


def delete_board_column(db: Session, column: models.BoardColumn,
                        move_tickets_to: Optional[models.BoardColumn]) -> bool:
    ticket_count = db.query(models.Ticket).filter(
        models.Ticket.column_id == column.id).count()
    if ticket_count > 0 and move_tickets_to is None:
        return False  # у колонці є тікети — потрібна цільова колонка

    if ticket_count > 0 and move_tickets_to is not None:
        db.query(models.Ticket).filter(models.Ticket.column_id == column.id).update(
            {models.Ticket.column_id: move_tickets_to.id}, synchronize_session=False)

    db.delete(column)
    # ущільнюємо позиції
    project_columns = get_project_columns(db, column.project_id)
    for idx, col in enumerate(project_columns):
        col.position = idx
    db.commit()
    return True


# --- TICKET CRUD ---
# Ієрархія: які типи тікетів можуть бути дітьми якого батька
PARENT_ALLOWED_CHILDREN = {
    models.TicketType.IDEA: [models.TicketType.EPIC, models.TicketType.TASK],
    models.TicketType.EPIC: [models.TicketType.TASK, models.TicketType.SUBTASK, models.TicketType.BUG],
    models.TicketType.TASK: [models.TicketType.SUBTASK, models.TicketType.BUG, models.TicketType.INCIDENT],
}


def validate_parent(db: Session, project: models.Project, parent_id: int,
                    child_type: models.TicketType,
                    exclude_ticket: Optional[models.Ticket] = None) -> models.Ticket:
    """Перевірка батьківського тікета: існування, той самий проект,
    дозволений тип дитини, без циклів."""
    parent = get_ticket_by_id(db, parent_id)
    if not parent or parent.project_id != project.id:
        raise ValueError("parent_not_found")

    if exclude_ticket and parent.id == exclude_ticket.id:
        raise ValueError("parent_is_self")

    allowed = PARENT_ALLOWED_CHILDREN.get(parent.type, [])
    if child_type not in allowed:
        raise ValueError("type_not_allowed")

    # цикл: предок не може бути нащадком самого себе
    node = parent
    while node is not None:
        if exclude_ticket and node.id == exclude_ticket.id:
            raise ValueError("parent_is_self")
        node = node.parent
    return parent


def get_ancestors(ticket: models.Ticket) -> list:
    """Ланцюг батьків від кореня до безпосереднього батька."""
    chain = []
    node = ticket.parent
    while node is not None:
        chain.append({
            "id": node.id,
            "key": node.key,
            "title": node.title,
            "type": node.type.value,
        })
        node = node.parent
    return list(reversed(chain))


def get_ticket_by_id(db: Session, ticket_id: int):
    return db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()


def get_ticket_by_key(db: Session, ticket_key: str):
    return db.query(models.Ticket).filter(models.Ticket.key == ticket_key).first()


def get_project_tickets(db: Session, project_id: int) -> List[models.Ticket]:
    return db.query(models.Ticket).filter(
        models.Ticket.project_id == project_id
    ).order_by(models.Ticket.created_at.desc()).all()


def _insert_ticket(db: Session, project: models.Project, column: models.BoardColumn,
                   title: str, description: Optional[str], type_: models.TicketType,
                   parent_id: Optional[int], assignee_id: Optional[int],
                   tester_id: Optional[int], reporter_id: int) -> models.Ticket:
    project.ticket_seq += 1
    ticket = models.Ticket(
        key=f"{project.key}-{project.ticket_seq}",
        title=title,
        description=description,
        type=type_,
        project_id=project.id,
        column_id=column.id,
        parent_id=parent_id,
        assignee_id=assignee_id,
        tester_id=tester_id,
        reporter_id=reporter_id,
        closed_at=datetime.utcnow() if column.is_done else None,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    log_history(db, ticket.id, reporter_id, "column", None, column.name)
    return ticket


def create_ticket(db: Session, project: models.Project,
                  payload: schemas.TicketCreate, reporter_id: int) -> models.Ticket:
    # ієрархія: валідація батька (тип дитини має бути дозволений)
    if payload.parent_id:
        validate_parent(db, project, payload.parent_id, payload.type)

    # підзадачі: тип кожної має бути дозволений для типу створюваного тікета
    if payload.subtasks:
        allowed_children = PARENT_ALLOWED_CHILDREN.get(payload.type, [])
        if any(sub.type not in allowed_children for sub in payload.subtasks):
            raise ValueError("subtask_type_not_allowed")

    # колонка: задана або перша за позицією
    columns = get_project_columns(db, project.id)
    if payload.column_id:
        column = db.query(models.BoardColumn).filter(
            models.BoardColumn.id == payload.column_id,
            models.BoardColumn.project_id == project.id,
        ).first()
        if not column:
            raise ValueError("column_not_found")
    else:
        column = columns[0]

    # вкладення, завантажені до створення тікета (тільки власні та без прив'язки)
    attachments = []
    if payload.attachment_ids:
        attachments = db.query(models.TicketAttachment).filter(
            models.TicketAttachment.id.in_(payload.attachment_ids),
            models.TicketAttachment.project_id == project.id,
            models.TicketAttachment.uploader_id == reporter_id,
            models.TicketAttachment.ticket_id.is_(None),
        ).all()

    ticket = _insert_ticket(db, project, column, payload.title, payload.description,
                            payload.type, payload.parent_id, payload.assignee_id,
                            payload.tester_id, reporter_id)

    for attachment in attachments:
        attachment.ticket_id = ticket.id

    # підзадачі створюються в першій колонці (як і швидка підзадача)
    if payload.subtasks:
        first_column = columns[0]
        for sub in payload.subtasks:
            _insert_ticket(db, project, first_column, sub.title.strip(), None, sub.type,
                           ticket.id, sub.assignee_id, None, reporter_id)

    db.commit()
    db.refresh(ticket)
    return ticket


def update_ticket(db: Session, ticket: models.Ticket,
                  payload: schemas.TicketUpdate, user_id: int) -> models.Ticket:
    data = payload.dict(exclude_unset=True)
    old_column = ticket.column

    if "parent_id" in data:
        new_parent_id = data["parent_id"]
        if new_parent_id != ticket.parent_id:
            if new_parent_id is None:
                data["parent_id"] = None  # відрив від батька
            else:
                validate_parent(db, ticket.project, new_parent_id, ticket.type,
                                exclude_ticket=ticket)
                old_parent = ticket.parent
                new_parent = get_ticket_by_id(db, new_parent_id)
                log_history(db, ticket.id, user_id, "parent",
                            old_parent.key if old_parent else None, new_parent.key)

    if "column_id" in data and data["column_id"] != ticket.column_id:
        new_column = db.query(models.BoardColumn).filter(
            models.BoardColumn.id == data["column_id"],
            models.BoardColumn.project_id == ticket.project_id,
        ).first()
        if not new_column:
            raise ValueError("column_not_found")
        data["column_id"] = new_column.id

    for field, new_value in data.items():
        old_value = getattr(ticket, field)
        old_str = old_value.value if hasattr(old_value, "value") else (
            str(old_value) if old_value is not None else None)
        new_str = new_value.value if hasattr(new_value, "value") else (
            str(new_value) if new_value is not None else None)
        if old_str != new_str:
            setattr(ticket, field, new_value)
            if field == "column_id" and old_column is not None:
                log_history(db, ticket.id, user_id, "column",
                            old_column.name, new_column.name)
            else:
                log_history(db, ticket.id, user_id, field, old_str, new_str)

    # closed_at за станом колонки
    if ticket.column is not None and ticket.column.is_done:
        if not ticket.closed_at:
            ticket.closed_at = datetime.utcnow()
    else:
        ticket.closed_at = None

    db.commit()
    db.refresh(ticket)
    return ticket


def delete_ticket(db: Session, ticket: models.Ticket) -> bool:
    # діти стають кореневими тікетами (без сиріт)
    db.query(models.Ticket).filter(
        models.Ticket.parent_id == ticket.id).update(
        {models.Ticket.parent_id: None}, synchronize_session=False)
    purge_ticket_attachments(db, [ticket.id])
    db.query(models.TicketHistory).filter(
        models.TicketHistory.ticket_id == ticket.id).delete(synchronize_session=False)
    db.delete(ticket)
    db.commit()
    return True


# --- STATS ---
def _avg_lifetime_hours(db: Session, project_id: Optional[int] = None,
                        reporter_id: Optional[int] = None) -> Optional[float]:
    query = db.query(models.Ticket).filter(models.Ticket.closed_at.isnot(None))
    if project_id is not None:
        query = query.filter(models.Ticket.project_id == project_id)
    if reporter_id is not None:
        query = query.filter(models.Ticket.reporter_id == reporter_id)
    tickets = query.all()
    if not tickets:
        return None
    total_hours = sum(
        (t.closed_at - t.created_at).total_seconds() / 3600.0 for t in tickets
    )
    return round(total_hours / len(tickets), 1)


def get_project_stats(db: Session, project: models.Project,
                      role: models.ProjectRole) -> schemas.ProjectStats:
    tickets = db.query(models.Ticket).filter(
        models.Ticket.project_id == project.id).all()
    columns = get_project_columns(db, project.id)
    column_names = {c.id: c.name for c in columns}
    done_ids = {c.id for c in columns if c.is_done}

    by_type: dict = {}
    by_column: dict = {}
    done = 0
    for t in tickets:
        by_type[t.type.value] = by_type.get(t.type.value, 0) + 1
        col_name = column_names.get(t.column_id, "?")
        by_column[col_name] = by_column.get(col_name, 0) + 1
        if t.column_id in done_ids:
            done += 1

    return schemas.ProjectStats(
        project_id=project.id,
        name=project.name,
        key=project.key,
        project_type=project.project_type,
        role=role,
        tickets_total=len(tickets),
        tickets_done=done,
        tickets_open=len(tickets) - done,
        by_type=by_type,
        by_column=by_column,
        avg_lifetime_hours=_avg_lifetime_hours(db, project_id=project.id),
    )


def get_dashboard_stats(db: Session, user: models.User) -> schemas.DashboardStats:
    projects = get_user_projects(db, user.id)
    stats = []
    for project in projects:
        role = get_member_role(db, project.id, user.id)
        stats.append(get_project_stats(db, project, role))

    total = sum(s.tickets_total for s in stats)
    lifetimes = [s.avg_lifetime_hours for s in stats if s.avg_lifetime_hours is not None]
    avg = round(sum(lifetimes) / len(lifetimes), 1) if lifetimes else None

    return schemas.DashboardStats(projects=stats, tickets_total=total, avg_lifetime_hours=avg)


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
