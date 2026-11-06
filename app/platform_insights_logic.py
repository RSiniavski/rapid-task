"""Project Insights: the numbers per project and the two warning flags (inactive, empty)."""
from datetime import datetime, timedelta
from typing import Dict, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models

STATUSES = ("active", "archived", "suspended")
INACTIVE_DAYS = 30                       # no activity for this long = "inactive"


def project_metrics(db: Session, projects: Iterable[models.Project], now: Optional[datetime] = None) -> Dict[int, dict]:
    """members, tickets, open tickets, last activity and the flags for every project (a few grouped queries, no loop of queries).
    Last activity = the newest ticket, history line (field changes, comments, files, sub-tickets) or comment; a project
    without any of them counts from the day it was created."""
    projects = list(projects)
    now = now or datetime.utcnow()
    ids = [p.id for p in projects]
    if not ids:
        return {}
    T, H, C = models.Ticket, models.TicketHistory, models.TicketComment
    members = dict(db.query(models.ProjectMember.project_id, func.count(models.ProjectMember.id))
                   .filter(models.ProjectMember.project_id.in_(ids)).group_by(models.ProjectMember.project_id).all())
    tickets = dict(db.query(T.project_id, func.count(T.id)).filter(T.project_id.in_(ids)).group_by(T.project_id).all())
    opened = dict(db.query(T.project_id, func.count(T.id))
                  .join(models.BoardColumn, T.column_id == models.BoardColumn.id)
                  .filter(T.project_id.in_(ids), models.BoardColumn.is_done.is_(False)).group_by(T.project_id).all())
    newest: Dict[int, datetime] = {}

    def take(rows):
        for pid, when in rows:
            if when is not None and (pid not in newest or when > newest[pid]):
                newest[pid] = when

    take(db.query(T.project_id, func.max(T.created_at)).filter(T.project_id.in_(ids)).group_by(T.project_id).all())
    take(db.query(T.project_id, func.max(H.created_at)).join(H, H.ticket_id == T.id)
         .filter(T.project_id.in_(ids)).group_by(T.project_id).all())
    take(db.query(T.project_id, func.max(C.created_at)).join(C, C.ticket_id == T.id)
         .filter(T.project_id.in_(ids)).group_by(T.project_id).all())

    limit = now - timedelta(days=INACTIVE_DAYS)
    out = {}
    for p in projects:
        last = max([d for d in (newest.get(p.id), p.created_at) if d is not None], default=None)
        live = (p.status or "active") == "active"          # the warnings are for working projects only
        out[p.id] = {
            "members_count": members.get(p.id, 0),
            "tickets_total": tickets.get(p.id, 0),
            "tickets_open": opened.get(p.id, 0),
            "last_activity_at": last,
            "inactive": bool(live and last is not None and last < limit),
            "empty": bool(live and (tickets.get(p.id, 0) == 0 or members.get(p.id, 0) <= 1)),
        }
    return out
