from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from typing import Optional, List, Dict, Literal
from datetime import datetime, date
from app.models import TicketType, ProjectType, ProjectRole

# --- USER SCHEMAS ---
def _strip_name(value):
    """Trim surrounding whitespace BEFORE length checks, so '   ' becomes '' and is rejected."""
    return value.strip() if isinstance(value, str) else value

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72,
                          description="Пароль від 8 до 72 символів (bcrypt: не більше 72 байт)")
    full_name: str = Field(..., min_length=2, max_length=100,
                           description="Повне ім'я від 2 до 100 символів")

    _trim_name = field_validator("full_name", mode="before")(_strip_name)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        # bcrypt works on bytes: a 40-character Cyrillic/emoji password can already exceed 72 bytes
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes (non-ASCII characters take 2-4 bytes each)")
        return value

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    position: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool = True
    theme_id: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    position: Optional[str] = Field(None, max_length=100)

    _trim_name = field_validator("full_name", mode="before")(_strip_name)

class ThemeSelect(BaseModel):
    theme_id: Optional[int] = None   # null = no personal theme (use the default)

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

    model_config = ConfigDict(from_attributes=True)

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

    model_config = ConfigDict(from_attributes=True)

class ProjectMemberResponse(BaseModel):
    id: int
    user: UserResponse
    role: ProjectRole

    model_config = ConfigDict(from_attributes=True)

class ProjectResponse(BaseModel):
    id: int
    name: str
    key: str
    project_type: ProjectType
    language: str
    owner: UserResponse
    created_at: datetime
    columns: List[BoardColumnResponse] = []

    model_config = ConfigDict(from_attributes=True)

class ProjectDetailResponse(ProjectResponse):
    members: List[ProjectMemberResponse] = []

    model_config = ConfigDict(from_attributes=True)

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

    @field_validator("position", mode="before")
    @classmethod
    def position_not_null(cls, value):
        # explicit null would crash the reordering code (comparison with None) -> HTTP 500
        if value is None:
            raise ValueError("position must not be null")
        return value

# --- TICKET SCHEMAS ---
class AncestorItem(BaseModel):
    id: int
    key: str
    title: str
    type: str

    model_config = ConfigDict(from_attributes=True)

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

    model_config = ConfigDict(from_attributes=True)

class SubtaskCreate(BaseModel):
    """Підзадача, що створюється разом з батьківським тікетом."""
    title: str = Field(..., min_length=1, max_length=200)
    type: TicketType = TicketType.SUBTASK
    assignee_id: Optional[int] = None

    _trim_title = field_validator("title", mode="before")(_strip_name)

class TicketCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    type: TicketType = TicketType.TASK
    column_id: Optional[int] = None  # None -> перша колонка
    parent_id: Optional[int] = None  # батьківський тікет (ієрархія)
    milestone_id: Optional[int] = None  # Roadmap: віха, до якої належить тікет
    assignee_id: Optional[int] = None
    tester_id: Optional[int] = None
    subtasks: List[SubtaskCreate] = []      # підзадачі, створюються разом з тікетом
    attachment_ids: List[int] = []          # раніше завантажені файли для прив'язки

    _trim_title = field_validator("title", mode="before")(_strip_name)

class TicketUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    type: Optional[TicketType] = None
    assignee_id: Optional[int] = None
    tester_id: Optional[int] = None
    column_id: Optional[int] = None
    parent_id: Optional[int] = None
    milestone_id: Optional[int] = None  # None (явно) — зняти з віхи

    @field_validator("title", "type", mode="before")
    @classmethod
    def required_when_present(cls, value, info):
        # A field that is omitted is not validated, so it stays unchanged.
        # An explicit null would hit a NOT NULL column in the database -> HTTP 500.
        if value is None:
            raise ValueError(f"{info.field_name} must not be null")
        return _strip_name(value) if info.field_name == "title" else value

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
    milestone_id: Optional[int] = None
    ancestors: List[AncestorItem] = []  # ланцюг батьків від кореня до безпосереднього
    assignee: Optional[UserResponse]
    tester: Optional[UserResponse]
    reporter: UserResponse
    created_at: datetime
    closed_at: Optional[datetime] = None
    attachments: List[AttachmentResponse] = []
    history: List[HistoryResponse] = []

    model_config = ConfigDict(from_attributes=True)

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


# --- ROADMAP SCHEMAS ---
MilestoneStatus = Literal["planned", "in_progress", "done"]
DependencyType = Literal["FS", "SS", "FF", "SF"]
DependencyEntity = Literal["milestone", "ticket"]

class MilestoneCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[MilestoneStatus] = None      # лише для віхи без тікетів
    progress: Optional[int] = Field(None, ge=0, le=100)  # лише для віхи без тікетів
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class MilestoneUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[MilestoneStatus] = None
    progress: Optional[int] = Field(None, ge=0, le=100)
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class MilestoneResponse(BaseModel):
    id: int
    project_id: int
    title: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    status: MilestoneStatus
    progress: int
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    tickets_total: int = 0
    tickets_done: int = 0
    auto_managed: bool = False      # True — статус/прогрес рахуються з тікетів
    risk_level: Literal["none", "warning", "danger"] = "none"
    risk_reasons: List[str] = []
    blocked_by: List[int] = []      # id віх, що блокують старт
    is_blocked: bool = False
    downstream_count: int = 0       # скільки незавершених віх залежить від цієї
    is_bottleneck: bool = False

class DependencyCreate(BaseModel):
    entity: DependencyEntity = "milestone"
    predecessor_id: int
    successor_id: int
    type: DependencyType = "FS"

class DependencyUpdate(BaseModel):
    type: DependencyType

class DependencyResponse(BaseModel):
    id: int
    entity: DependencyEntity
    predecessor_id: int
    successor_id: int
    type: DependencyType
    state: Literal["ok", "waiting", "violated"] = "ok"
    schedule_conflict: bool = False

class LayoutItem(BaseModel):
    id: int
    x: float
    y: float

class LayoutUpdate(BaseModel):
    items: List[LayoutItem] = Field(..., max_length=500)

class RoadmapResponse(BaseModel):
    project_id: int
    milestones: List[MilestoneResponse] = []
    dependencies: List[DependencyResponse] = []
    blocked_ticket_ids: List[int] = []  # тікети, що чекають на попередників
