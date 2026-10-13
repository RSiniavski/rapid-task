import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Enum, DateTime, ForeignKey, Boolean, UniqueConstraint
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
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

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

    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    tester_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)  # момент потрапляння в колонку is_done

    project = relationship("Project", back_populates="tickets")
    column = relationship("BoardColumn", back_populates="tickets")
    parent = relationship("Ticket", remote_side=[id], backref="children")
    assignee = relationship("User", foreign_keys=[assignee_id], back_populates="assigned_tickets")
    tester = relationship("User", foreign_keys=[tester_id])
    reporter = relationship("User", foreign_keys=[reporter_id], back_populates="reported_tickets")
    history = relationship("TicketHistory", back_populates="ticket", cascade="all, delete-orphan")


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
