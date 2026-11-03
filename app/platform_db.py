"""Separate database for the platform (admin tool): ./platform.db, next to rapid_task.db.
Own engine and own declarative Base, so the main database never gets these tables."""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

PLATFORM_DATABASE_URL = "sqlite:///./platform.db"

platform_engine = create_engine(
    PLATFORM_DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30}
)
PlatformSession = sessionmaker(autocommit=False, autoflush=False, bind=platform_engine)

PlatformBase = declarative_base()


def ensure_platform_schema():
    """Light migration for an existing platform.db: create_all does not add columns to old tables."""
    from sqlalchemy import inspect, text
    insp = inspect(platform_engine)
    if "platform_admins" in insp.get_table_names():
        columns = {c["name"] for c in insp.get_columns("platform_admins")}
        if "theme_key" not in columns:
            with platform_engine.begin() as conn:
                conn.execute(text("ALTER TABLE platform_admins ADD COLUMN theme_key VARCHAR"))


def get_platform_db():
    db = PlatformSession()
    try:
        yield db
    finally:
        db.close()
