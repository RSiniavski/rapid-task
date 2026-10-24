import enum
from datetime import datetime
from sqlalchemy import (Column, Integer, String, Text, Enum, DateTime, Date, Float,
                        ForeignKey, Boolean, UniqueConstraint)
from sqlalchemy.orm import relationship
from app.database import Base


class ProjectType(str, enum.Enum):
    SOFTWARE_DEV = "software_dev"


class ProjectRole(str, enum.Enum):
    ADMIN = "admin"              # повний доступ + керування колонками/учасниками
    EDITOR = "editor"            # все, крім видалення тікетів
    CONTRIBUTOR = "contributor"  # свої тікети + ті, де він assignee/tester/reporter
    REPORTER = "reporter"        # тільки створення тікетів


class TicketType(str, enum.Enum):
    IDEA = "Idea"
    EPIC = "Epic"
    TASK = "Task"
    SUBTASK = "Subtask"
    BUG = "Bug"
    INCIDENT = "Incident"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    position = Column(String, nullable=True)      # посада (особистий кабінет)
    avatar_path = Column(String, nullable=True)   # ім'я файлу аватара в uploads/
    is_active = Column(Boolean, default=True, nullable=False)
    theme_id = Column(Integer, ForeignKey("themes.id"), nullable=True)  # personal theme
    created_at = Column(DateTime, default=datetime.utcnow)

    @property
    def avatar_url(self):
        return f"/uploads/{self.avatar_path}" if self.avatar_path else None

    assigned_tickets = relationship("Ticket", back_populates="assignee", foreign_keys="Ticket.assignee_id")
    reported_tickets = relationship("Ticket", back_populates="reporter", foreign_keys="Ticket.reporter_id")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    key = Column(String, unique=True, index=True, nullable=False)  # префікс тікетів, напр. "OBD"
    project_type = Column(Enum(ProjectType), default=ProjectType.SOFTWARE_DEV, nullable=False)
    language = Column(String, default="uk", nullable=False)  # мова інтерфейсу проекту
    ticket_seq = Column(Integer, default=0, nullable=False)  # лічильник для ключів OBD-1, OBD-2...
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    columns = relationship(
        "BoardColumn", back_populates="project",
        cascade="all, delete-orphan", order_by="BoardColumn.position",
    )
    tickets = relationship("Ticket", back_populates="project")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_user"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(Enum(ProjectRole), default=ProjectRole.CONTRIBUTOR, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="members")
    user = relationship("User")


class BoardColumn(Base):
    __tablename__ = "board_columns"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    is_done = Column(Boolean, default=False, nullable=False)  # колонка "закрито" для метрик

    project = relationship("Project", back_populates="columns")
    tickets = relationship("Ticket", back_populates="column")


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True, nullable=False)  # "OBD-12"
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    type = Column(Enum(TicketType), default=TicketType.TASK, nullable=False)

    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    column_id = Column(Integer, ForeignKey("board_columns.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("tickets.id"), nullable=True, index=True)  # ієрархія
    milestone_id = Column(Integer, ForeignKey("milestones.id"), nullable=True, index=True)  # Roadmap: віха

    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    tester_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)  # момент потрапляння в колонку is_done

    project = relationship("Project", back_populates="tickets")
    column = relationship("BoardColumn", back_populates="tickets")
    parent = relationship("Ticket", remote_side=[id], backref="children")
    milestone = relationship("Milestone", back_populates="tickets")
    assignee = relationship("User", foreign_keys=[assignee_id], back_populates="assigned_tickets")
    tester = relationship("User", foreign_keys=[tester_id])
    reporter = relationship("User", foreign_keys=[reporter_id], back_populates="reported_tickets")
    history = relationship("TicketHistory", back_populates="ticket", cascade="all, delete-orphan")
    attachments = relationship("TicketAttachment", back_populates="ticket",
                               order_by="TicketAttachment.id")


class TicketHistory(Base):
    __tablename__ = "ticket_history"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    field_changed = Column(String, nullable=False)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    ticket = relationship("Ticket", back_populates="history")
    user = relationship("User")


class TicketAttachment(Base):
    """Файл, прикріплений до тікета. ticket_id = NULL — файл завантажено
    під час створення тікета і ще не прив'язано (прив'язується при створенні)."""
    __tablename__ = "ticket_attachments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)       # оригінальна назва
    stored_name = Column(String, unique=True, nullable=False)  # uuid.ext в uploads/
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    ticket = relationship("Ticket", back_populates="attachments")

    @property
    def url(self):
        return f"/uploads/{self.stored_name}"

    @property
    def kind(self):
        from app.files import kind_of
        return kind_of(self.content_type)


class Milestone(Base):
    """Macro-block / Milestone (віха, етап) на Roadmap-полотні.

    status/progress для віхи з тікетами рахуються автоматично
    (crud.recalc_project_milestones); для порожньої віхи — задаються вручну.
    pos_x/pos_y — координати блоку на нескінченному полотні."""
    __tablename__ = "milestones"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="planned")   # planned | in_progress | done
    progress = Column(Integer, nullable=False, default=0)        # 0..100
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tickets = relationship("Ticket", back_populates="milestone")


class RoadmapDependency(Base):
    """Залежність між двома віхами АБО двома тікетами одного проекту.
    type: FS (Finish-to-Start), SS, FF, SF. predecessor -> successor."""
    __tablename__ = "roadmap_dependencies"
    __table_args__ = (UniqueConstraint("entity", "predecessor_id", "successor_id",
                                       name="uq_roadmap_dependency"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    entity = Column(String, nullable=False, default="milestone")  # milestone | ticket
    predecessor_id = Column(Integer, nullable=False, index=True)
    successor_id = Column(Integer, nullable=False, index=True)
    type = Column(String, nullable=False, default="FS")
    created_at = Column(DateTime, default=datetime.utcnow)

class Theme(Base):
    __tablename__ = "themes"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=True)      # stable name for presets, e.g. "nord"
    name = Column(String, nullable=False)
    is_preset = Column(Boolean, default=False, nullable=False)
    data = Column(Text, nullable=False)                   # theme JSON (colors, shadows, typography)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # null for presets
    created_at = Column(DateTime, default=datetime.utcnow)