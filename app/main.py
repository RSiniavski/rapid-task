from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import auth, tickets, users, projects

# Автоматичне створення таблиць в SQLite при першому запуску
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Rapid Task API", version="2.0.0")

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
app.include_router(projects.router)
app.include_router(tickets.router)

# Раздача статики (HTML/JS/CSS)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
