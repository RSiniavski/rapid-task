from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./rapid_task.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema():
    """Легка міграція для SQLite: create_all не додає колонки до наявних таблиць,
    тому нові поля (users.position/avatar_path, tickets.milestone_id) додаємо вручну
    (безпечно для повторних запусків)."""
    insp = inspect(engine)
    tables = insp.get_table_names()
    with engine.begin() as conn:
        if "users" in tables:
            existing = {c["name"] for c in insp.get_columns("users")}
            if "position" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN position VARCHAR"))
            if "avatar_path" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN avatar_path VARCHAR"))
        # Roadmap: зв'язок тікет → віха (таблиці milestones/roadmap_dependencies
        # створює create_all; нова колонка в наявній tickets — тут)
        if "tickets" in tables:
            ticket_cols = {c["name"] for c in insp.get_columns("tickets")}
            if "milestone_id" not in ticket_cols:
                conn.execute(text("ALTER TABLE tickets ADD COLUMN milestone_id INTEGER"))
        # Roadmap: таблиця milestones зі старої чернетки (color/position_x/position_y замість
        # progress/pos_x/pos_y) перебудовується під поточну модель разом з даними
        if "milestones" in tables:
            from app import schema_migrations
            from app.models import Milestone  # імпорт тут — models імпортує Base звідси
            schema_migrations.migrate_legacy_milestones(
                conn, lambda c: Milestone.__table__.create(bind=c))
