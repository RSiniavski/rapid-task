from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import engine, Base
from app.routers import auth, tickets, users

# Автоматичне створення таблиць в SQLite при першому запуску
Base.metadata.create_all(bind=engine)

# Додавання колонки is_active, якщо її ще немає в існуючій базі
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"))
        conn.commit()
    except Exception:
        pass

app = FastAPI(title="Rapid Task API", version="1.0.0")

# Налаштування CORS (для можливих зовнішніх запитів)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Підключення API роутерів
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tickets.router)

# Раздача статики (HTML/JS/CSS)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
