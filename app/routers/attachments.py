from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import schemas, crud, auth, models, files

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


@router.post("", response_model=schemas.AttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    project_id: int = Query(..., description="Проект, до якого належить файл"),
    ticket_id: Optional[int] = Query(None, description="Тікет; якщо не задано — файл для нового тікета"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    role = crud.get_member_role(db, project_id, current_user.id)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")

    if ticket_id is not None:
        ticket = crud.get_ticket_by_id(db, ticket_id)
        if not ticket or ticket.project_id != project_id:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if not crud.can_edit_ticket(db, ticket, current_user.id, role):
            raise HTTPException(status_code=403, detail="Not allowed to edit this ticket")

    filename = (file.filename or "file").replace("\\", "/").split("/")[-1][:255] or "file"
    content_type = files.guess_type(filename, file.content_type)
    stored_name, size = await files.save_upload(file, files.MAX_ATTACHMENT_SIZE)

    return crud.create_attachment(db, project_id, ticket_id, current_user.id,
                                  filename, stored_name, content_type, size)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    attachment = crud.get_attachment(db, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    role = crud.get_member_role(db, attachment.project_id, current_user.id)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this project")

    if attachment.ticket_id is None:
        # ще не прив'язаний до тікета — може видалити лише той, хто завантажив
        if attachment.uploader_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not allowed")
    else:
        ticket = crud.get_ticket_by_id(db, attachment.ticket_id)
        if not ticket or not crud.can_edit_ticket(db, ticket, current_user.id, role):
            raise HTTPException(status_code=403, detail="Not allowed to edit this ticket")

    crud.delete_attachment(db, attachment)
    return None
