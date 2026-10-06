from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from app.models import TicketType, TicketStatus

# --- USER SCHEMAS ---
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=72, description="Пароль не більше 72 символів")
    full_name: str

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_active: bool = True

    class Config:
        from_attributes = True

# --- AUTH SCHEMAS ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    user_id: Optional[int] = None

# --- HISTORY SCHEMAS ---
class HistoryResponse(BaseModel):
    id: int
    field_changed: str
    old_value: Optional[str]
    new_value: Optional[str]
    created_at: datetime
    user_id: int

    class Config:
        from_attributes = True

# --- TICKET SCHEMAS ---
class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: TicketType = TicketType.TASK
    assignee_id: Optional[int] = None

class TicketUpdateStatus(BaseModel):
    status: TicketStatus

class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[TicketType] = None
    status: Optional[TicketStatus] = None
    assignee_id: Optional[int] = None

class TicketResponse(BaseModel):
    id: int
    key: str
    title: str
    description: Optional[str]
    type: TicketType
    status: TicketStatus
    assignee: Optional[UserResponse]
    reporter: UserResponse
    created_at: datetime
    history: List[HistoryResponse] = []

    class Config:
        from_attributes = True
