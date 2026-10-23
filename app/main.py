import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base, ensure_schema
from app.routers import auth, tickets, users, projects, attachments, roadmap
from app import files

# Автоматичне створення таблиць в SQLite при першому запуску
Base.metadata.create_all(bind=engine)
# Додає нові колонки (users.position, users.avatar_path) до вже наявної БД
ensure_schema()
files.ensure_upload_dir()

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
app.include_router(attachments.router)
app.include_router(roadmap.router)


# Завантажені файли (аватари та вкладення). Імена — випадкові uuid.
# Зображення/відео/аудіо/PDF відкриваються в браузері, решта — завантажується
# (HTML/SVG та ін. ніколи не виконуються в нашому origin).
@app.get("/uploads/{stored_name}", include_in_schema=False)
def get_upload(stored_name: str):
    path = files.resolve_stored(stored_name)
    if path is None:
        raise HTTPException(status_code=404, detail="File not found")
    import mimetypes
    ctype = mimetypes.guess_type(stored_name)[0] or "application/octet-stream"
    inline = (ctype.startswith(files.INLINE_PREFIXES) or ctype in files.INLINE_EXACT) \
        and ctype not in files.NEVER_INLINE
    headers = {"X-Content-Type-Options": "nosniff"}
    if not inline:
        headers["Content-Security-Policy"] = "sandbox"
    return FileResponse(path, media_type=ctype if inline else "application/octet-stream",
                        filename=stored_name,
                        content_disposition_type="inline" if inline else "attachment",
                        headers=headers)

# Роздача ресурсів та статики (HTML/JS/CSS)
if os.path.exists("resources"):
    app.mount("/resources", StaticFiles(directory="resources"), name="resources")
app.mount("/", StaticFiles(directory="static", html=True), name="static")
