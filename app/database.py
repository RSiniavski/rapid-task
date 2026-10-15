from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

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
    тому нові поля users додаємо вручну (безпечно для повторних запусків)."""
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("users")}
    with engine.begin() as conn:
        if "position" not in existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN position VARCHAR"))
        if "avatar_path" not in existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar_path VARCHAR"))
