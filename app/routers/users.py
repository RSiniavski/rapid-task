from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import schemas, crud, auth, models, files

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.get("", response_model=List[schemas.UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return crud.get_users(db)


# --- Особистий кабінет (маршрути /me мають бути перед /{user_id}) ---
@router.patch("/me", response_model=schemas.UserResponse)
def update_my_profile(
    payload: schemas.ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return crud.update_profile(db, current_user, payload)


@router.post("/me/avatar", response_model=schemas.UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    content_type = (file.content_type or "").lower()
    ext = files.AVATAR_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Avatar must be a PNG, JPEG, GIF or WebP image")
    stored_name, _ = await files.save_upload(
        file, files.MAX_AVATAR_SIZE, prefix="avatar_", ext=ext)
    return crud.set_user_avatar(db, current_user, stored_name)


@router.delete("/me/avatar", response_model=schemas.UserResponse)
def delete_my_avatar(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return crud.set_user_avatar(db, current_user, None)


@router.get("/{user_id}", response_model=schemas.UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    user = crud.get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    hard_delete: bool = Query(False, description="True для повного тестового видалення (каскадне очищення), False для деактивації"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    success = crud.delete_user(db=db, user_id=user_id, hard_delete=hard_delete)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return None


@router.post("/{user_id}/deactivate", response_model=schemas.UserResponse)
def deactivate_user_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    user = crud.deactivate_user(db=db, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
