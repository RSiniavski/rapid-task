from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict
from datetime import datetime
from app.models import TicketType, ProjectType, ProjectRole

# --- USER SCHEMAS ---
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=72, description="Пароль не більше 72 символів")
    full_name: str

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    position: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    position: Optional[str] = Field(None, max_length=100)

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

# --- PROJECT SCHEMAS ---
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    key: str = Field(..., min_length=2, max_length=10, pattern=r"^[A-Z][A-Z0-9]*$",
                     description="Префікс тікетів, напр. OBD (великі латинські літери/цифри)")
    language: str = Field("uk", pattern=r"^(uk|en)$")
    project_type: ProjectType = ProjectType.SOFTWARE_DEV

class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    language: Optional[str] = Field(None, pattern=r"^(uk|en)$")

class BoardColumnResponse(BaseModel):
    id: int
    name: str
    position: int
    is_done: bool

    class Config:
        from_attributes = True

class ProjectMemberResponse(BaseModel):
    id: int
    user: UserResponse
    role: ProjectRole

    class Config:
        from_attributes = True

class ProjectResponse(BaseModel):
    id: int
    name: str
    key: str
    project_type: ProjectType
    language: str
    owner: UserResponse
    created_at: datetime
    columns: List[BoardColumnResponse] = []

    class Config:
        from_attributes = True

class ProjectDetailResponse(ProjectResponse):
    members: List[ProjectMemberResponse] = []

    class Config:
        from_attributes = True

class MemberAdd(BaseModel):
    email: Optional[EmailStr] = None
    user_id: Optional[int] = None
    role: ProjectRole = ProjectRole.CONTRIBUTOR

class MemberUpdate(BaseModel):
    role: ProjectRole

# --- BOARD COLUMN SCHEMAS ---
class ColumnCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    position: Optional[int] = None  # None -> в кінець

class ColumnUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    position: Optional[int] = None
    is_done: Optional[bool] = None

# --- TICKET SCHEMAS ---
class AncestorItem(BaseModel):
    id: int
    key: str
    title: str
    type: str

    class Config:
        from_attributes = True

class AttachmentResponse(BaseModel):
    id: int
    ticket_id: Optional[int] = None
    filename: str
    url: str
    content_type: Optional[str] = None
    size: int = 0
    kind: str = "file"  # image | video | audio | file
    created_at: datetime
    uploader_id: int

    class Config:
        from_attributes = True

class SubtaskCreate(BaseModel):
    """Підзадача, що створюється разом з батьківським тікетом."""
    title: str = Field(..., min_length=1, max_length=200)
    type: TicketType = TicketType.SUBTASK
    assignee_id: Optional[int] = None

class TicketCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    type: TicketType = TicketType.TASK
    column_id: Optional[int] = None  # None -> перша колонка
    parent_id: Optional[int] = None  # батьківський тікет (ієрархія)
    assignee_id: Optional[int] = None
    tester_id: Optional[int] = None
    subtasks: List[SubtaskCreate] = []      # підзадачі, створюються разом з тікетом
    attachment_ids: List[int] = []          # раніше завантажені файли для прив'язки

class TicketUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    type: Optional[TicketType] = None
    assignee_id: Optional[int] = None
    tester_id: Optional[int] = None
    column_id: Optional[int] = None
    parent_id: Optional[int] = None

class TicketColumnUpdate(BaseModel):
    column_id: int

class TicketResponse(BaseModel):
    id: int
    key: str
    title: str
    description: Optional[str]
    type: TicketType
    project_id: int
    column_id: int
    column: Optional[BoardColumnResponse] = None
    parent_id: Optional[int] = None
    ancestors: List[AncestorItem] = []  # ланцюг батьків від кореня до безпосереднього
    assignee: Optional[UserResponse]
    tester: Optional[UserResponse]
    reporter: UserResponse
    created_at: datetime
    closed_at: Optional[datetime] = None
    attachments: List[AttachmentResponse] = []
    history: List[HistoryResponse] = []

    class Config:
        from_attributes = True

# --- STATS SCHEMAS ---
class ProjectStats(BaseModel):
    project_id: int
    name: str
    key: str
    project_type: ProjectType
    role: ProjectRole
    tickets_total: int
    tickets_done: int
    tickets_open: int
    by_type: Dict[str, int] = {}
    by_column: Dict[str, int] = {}
    avg_lifetime_hours: Optional[float] = None

class DashboardStats(BaseModel):
    projects: List[ProjectStats] = []
    tickets_total: int = 0
    avg_lifetime_hours: Optional[float] = None
