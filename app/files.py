"""Робота з файлами завантажень (аватари та вкладення тікетів)."""
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"

MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024   # 25 МБ
MAX_AVATAR_SIZE = 5 * 1024 * 1024        # 5 МБ

# SVG навмисно не входить: може містити скрипти
AVATAR_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}

# Ці типи показуються браузером "inline"; решта завжди віддається як завантаження
INLINE_PREFIXES = ("image/", "video/", "audio/")
INLINE_EXACT = {"application/pdf"}
NEVER_INLINE = {"image/svg+xml"}

_STORED_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$")


def ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def guess_type(filename: str, declared: Optional[str]) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    if declared and declared != "application/octet-stream":
        return declared
    return guessed or "application/octet-stream"


def kind_of(content_type: Optional[str]) -> str:
    ct = (content_type or "").lower()
    if ct in NEVER_INLINE:
        return "file"
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("audio/"):
        return "audio"
    return "file"


def safe_extension(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", ext or ""):
        return ".bin"
    return ext


async def save_upload(file: UploadFile, max_size: int, prefix: str = "",
                      ext: Optional[str] = None) -> tuple:
    """Зберігає файл під випадковим ім'ям. Повертає (stored_name, size)."""
    ensure_upload_dir()
    stored_name = f"{prefix}{uuid.uuid4().hex}{ext or safe_extension(file.filename or '')}"
    path = UPLOAD_DIR / stored_name
    size = 0
    try:
        with open(path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is too large (max {max_size // (1024 * 1024)} MB)")
                out.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    if size == 0:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file")
    return stored_name, size


def delete_stored(stored_name: Optional[str]) -> None:
    if stored_name and _STORED_RE.match(stored_name):
        (UPLOAD_DIR / stored_name).unlink(missing_ok=True)


def resolve_stored(stored_name: str) -> Optional[Path]:
    if not _STORED_RE.match(stored_name):
        return None
    path = UPLOAD_DIR / stored_name
    return path if path.is_file() else None
