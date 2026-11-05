"""Numbers for the platform Overview page (permission: can_view_analytics).
All values are counted live from the application data. The only extra table is user_activity_days
(one row per user per UTC day), because the application keeps just the *last* login of a user."""
from datetime import date, datetime, time, timedelta
from typing import Dict, List

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app import platform_users_logic as ul

PERIODS = (7, 30, 90)
MAX_STATUSES = 8                      # more column names than this are summed up as "Other"

_seen: Dict[int, date] = {}           # user id -> the day already saved (so a busy user writes once a day)


def touch_activity_day(db: Session, user_id: int) -> None:
    """Remember that the user was active today. Never breaks the request that called it."""
    today = datetime.utcnow().date()
    if _seen.get(user_id) == today:
        return
    try:
        exists = db.query(models.UserActivityDay.id).filter(
            models.UserActivityDay.user_id == user_id, models.UserActivityDay.day == today).first()
        if exists is None:
            db.add(models.UserActivityDay(user_id=user_id, day=today))
            db.commit()
        _seen[user_id] = today
    except IntegrityError:            # another request was faster: the row is there, that is all we need
        db.rollback()
        _seen[user_id] = today
    except Exception:                 # statistics must never stop a login or an API call
        db.rollback()


def _per_day(db: Session, column, start: datetime, *extra) -> Dict[str, int]:
    day = func.date(column)
    q = db.query(day, func.count()).filter(column >= start, *extra).group_by(day)
    return {str(d): n for d, n in q.all()}


def _count(db: Session, column, start: datetime) -> int:
    return db.query(func.count()).select_from(column.class_).filter(column >= start).scalar() or 0


def _statuses(db: Session) -> List[dict]:
    rows = (db.query(models.BoardColumn.name, models.BoardColumn.is_done, func.count(models.Ticket.id))
            .join(models.Ticket, models.Ticket.column_id == models.BoardColumn.id)
            .group_by(models.BoardColumn.name, models.BoardColumn.is_done).all())
    merged: Dict[str, dict] = {}
    for name, is_done, count in rows:               # the same name in many projects is one bar
        key = (name or "").strip().lower()
        item = merged.setdefault(key, {"name": (name or "").strip() or "—", "count": 0, "is_done": False})
        item["count"] += count
        item["is_done"] = item["is_done"] or bool(is_done)
    items = sorted(merged.values(), key=lambda x: (-x["count"], x["name"].lower()))
    if len(items) > MAX_STATUSES:
        rest = sum(i["count"] for i in items[MAX_STATUSES:])
        items = items[:MAX_STATUSES] + [{"name": "Other", "count": rest, "is_done": False}]
    return items


def build(db: Session, days: int) -> dict:
    today = datetime.utcnow().date()
    first = today - timedelta(days=days - 1)
    start = datetime.combine(first, time.min)
    dates = [first + timedelta(days=i) for i in range(days)]
    U, P, T = models.User, models.Project, models.Ticket

    def users_with(status: str) -> int:
        return db.query(func.count(U.id)).filter(ul.status_condition(status)).scalar() or 0

    active, blocked, deactivated, deleted = (users_with(s) for s in ul.STATUSES)
    tickets_total = db.query(func.count(T.id)).scalar() or 0
    done_now = (db.query(func.count(T.id)).join(models.BoardColumn, T.column_id == models.BoardColumn.id)
                .filter(models.BoardColumn.is_done.is_(True)).scalar() or 0)

    busy = {pid for (pid,) in db.query(T.project_id).filter(T.created_at >= start).all()}
    busy |= {pid for (pid,) in db.query(T.project_id).join(models.TicketHistory, models.TicketHistory.ticket_id == T.id)
             .filter(models.TicketHistory.created_at >= start).distinct().all()}

    series = {
        "new_users": _per_day(db, U.created_at, start),
        "new_projects": _per_day(db, P.created_at, start),
        "new_tickets": _per_day(db, T.created_at, start),
        "active_users": {str(d): n for d, n in db.query(models.UserActivityDay.day, func.count())
                         .filter(models.UserActivityDay.day >= first).group_by(models.UserActivityDay.day).all()},
    }
    by_type = dict(db.query(T.type, func.count(T.id)).group_by(T.type).all())
    since = db.query(func.min(models.UserActivityDay.day)).scalar()

    return {
        "period": {"days": days, "first_day": first.isoformat(), "last_day": today.isoformat()},
        "users": {"total": active + blocked + deactivated, "active": active, "blocked": blocked,
                  "deactivated": deactivated, "deleted": deleted, "new": _count(db, U.created_at, start)},
        "projects": {"total": db.query(func.count(P.id)).scalar() or 0, "new": _count(db, P.created_at, start),
                     "with_activity": len(busy)},
        "tickets": {"total": tickets_total, "open": tickets_total - done_now, "created": _count(db, T.created_at, start),
                    "done": _count(db, T.closed_at, start)},
        "activity": {"comments": _count(db, models.TicketComment.created_at, start),
                     "attachments": _count(db, models.TicketAttachment.created_at, start)},
        "series": {"days": [d.isoformat() for d in dates],
                   **{k: [v.get(d.isoformat(), 0) for d in dates] for k, v in series.items()}},
        "activity_since": since.isoformat() if since else None,
        "tickets_by_status": _statuses(db),
        "tickets_by_type": [{"type": t.value, "count": by_type.get(t, 0)} for t in models.TicketType],
    }
