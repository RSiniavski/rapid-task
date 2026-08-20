import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Enum, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class TicketType(str, enum.Enum):
    EPIC = "Epic"
    TASK = "Task"
    SUBTASK = "Subtask"
    BUG = "Bug"


class TicketStatus(str, enum.Enum):
    TODO = "ToDo"
    IN_PROGRESS = "In progress"
    READY_FOR_TESTING = "ready for testing"
    TESTING = "testing"
    READY_FOR_DEPLOY = "ready for deploy"
    DEPLOYED = "deployed"
    DONE = "done"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    assigned_tickets = relationship("Ticket", back_populates="assignee", foreign_keys="Ticket.assignee_id")
    reported_tickets = relationship("Ticket", back_populates="reporter", foreign_keys="Ticket.reporter_id")


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    type = Column(Enum(TicketType), default=TicketType.TASK, nullable=False)
    status = Column(Enum(TicketStatus), default=TicketStatus.TODO, nullable=False)

    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    assignee = relationship("User", foreign_keys=[assignee_id], back_populates="assigned_tickets")
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