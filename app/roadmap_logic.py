"""
Nested Dependency Roadmap — чиста бізнес-логіка (без залежностей від БД/FastAPI).

Тут зібрано все, що можна перевірити звичайними unit-тестами:
  * авто-прогрес і статус віхи за її тікетами;
  * стан залежності (ok / waiting / violated) для типів FS, SS, FF, SF;
  * конфлікт календарних дат;
  * пошук циклів у графі залежностей;
  * аналіз ризиків ланцюжка: ризик, блокування, вузькі місця (bottlenecks).

Об'єкти, що аналізуються, передаються як прості dict-и, тому модуль однаково
працює і з ORM-моделями (після перетворення), і в тестах.
"""
from datetime import date
from typing import Dict, Iterable, List, Optional, Set

# ---------- Константи ----------
STATUS_PLANNED = "planned"
STATUS_IN_PROGRESS = "in_progress"
STATUS_DONE = "done"
STATUSES = (STATUS_PLANNED, STATUS_IN_PROGRESS, STATUS_DONE)

DEP_FS = "FS"  # Finish-to-Start: наступник стартує після завершення попередника
DEP_SS = "SS"  # Start-to-Start: наступник стартує не раніше старту попередника
DEP_FF = "FF"  # Finish-to-Finish: наступник завершується не раніше попередника
DEP_SF = "SF"  # Start-to-Finish: наступник завершується не раніше старту попередника
DEP_TYPES = (DEP_FS, DEP_SS, DEP_FF, DEP_SF)

ENTITY_MILESTONE = "milestone"
ENTITY_TICKET = "ticket"
ENTITIES = (ENTITY_MILESTONE, ENTITY_TICKET)

STATE_OK = "ok"
STATE_WAITING = "waiting"
STATE_VIOLATED = "violated"

RISK_NONE = "none"
RISK_WARNING = "warning"
RISK_DANGER = "danger"

DUE_SOON_DAYS = 7          # «дедлайн близько»
DUE_SOON_MAX_PROGRESS = 50  # ...і прогрес менше цього відсотка → попередження
BOTTLENECK_MIN_DOWNSTREAM = 2  # скільки незавершених нащадків робить блок «вузьким місцем»


# ---------- Прогрес і статус ----------
def compute_progress_status(total: int, done: int, touched: int):
    """Прогрес (0–100) і статус віхи за її тікетами.

    total   — скільки тікетів у віхи;
    done    — скільки з них у колонці «закрито»;
    touched — скільки тікетів вже не в першій колонці (хоч якийсь рух).
    Якщо тікетів немає — повертає None (прогрес/статус керуються вручну).
    """
    if total <= 0:
        return None
    progress = int(round(done * 100.0 / total))
    if done >= total:
        return 100, STATUS_IN_PROGRESS   # all tickets done: wait for a manual "Close"
    if done > 0 or touched > 0:
        return progress, STATUS_IN_PROGRESS
    return progress, STATUS_PLANNED


def ticket_status(is_done: bool, in_first_column: bool) -> str:
    """Статус окремого тікета для аналізу залежностей між тікетами."""
    if is_done:
        return STATUS_DONE
    return STATUS_PLANNED if in_first_column else STATUS_IN_PROGRESS


def _started(status: str) -> bool:
    return status in (STATUS_IN_PROGRESS, STATUS_DONE)


# ---------- Стан залежності ----------
def dependency_state(dep_type: str, pred_status: str, succ_status: str) -> str:
    """
    ok        — умова залежності виконана;
    waiting   — умова ще не виконана, але наступник нічого не порушив;
    violated  — наступник вже зробив те, що залежність забороняє.
    """
    if dep_type == DEP_FS:
        if pred_status == STATUS_DONE:
            return STATE_OK
        return STATE_WAITING if succ_status == STATUS_PLANNED else STATE_VIOLATED
    if dep_type == DEP_SS:
        if _started(pred_status):
            return STATE_OK
        return STATE_WAITING if succ_status == STATUS_PLANNED else STATE_VIOLATED
    if dep_type == DEP_FF:
        if pred_status == STATUS_DONE:
            return STATE_OK
        return STATE_VIOLATED if succ_status == STATUS_DONE else STATE_WAITING
    if dep_type == DEP_SF:
        if _started(pred_status):
            return STATE_OK
        return STATE_VIOLATED if succ_status == STATUS_DONE else STATE_WAITING
    raise ValueError(f"unknown dependency type: {dep_type}")


def blocks_start(dep_type: str) -> bool:
    """Чи заважає невиконана залежність СТАРТУВАТИ наступнику (FS і SS)."""
    return dep_type in (DEP_FS, DEP_SS)


def schedule_conflict(dep_type: str, pred: dict, succ: dict) -> bool:
    """Конфлікт дат: за календарем залежність не може бути виконана.
    Враховується лише поки умова залежності ще не виконана."""
    p_start, p_due = pred.get("start_date"), pred.get("due_date")
    s_start, s_due = succ.get("start_date"), succ.get("due_date")
    p_status = pred.get("status", STATUS_PLANNED)

    if dep_type == DEP_FS:
        return p_status != STATUS_DONE and _gt(p_due, s_start)
    if dep_type == DEP_FF:
        return p_status != STATUS_DONE and _gt(p_due, s_due)
    if dep_type == DEP_SS:
        return not _started(p_status) and _gt(p_start, s_start)
    if dep_type == DEP_SF:
        return not _started(p_status) and _gt(p_start, s_due)
    return False


def _gt(a: Optional[date], b: Optional[date]) -> bool:
    return a is not None and b is not None and a > b


# ---------- Граф ----------
def would_create_cycle(edges: Iterable[tuple], predecessor_id: int, successor_id: int) -> bool:
    """edges — пари (predecessor, successor). Чи створить нове ребро цикл?"""
    if predecessor_id == successor_id:
        return True
    adj: Dict[int, List[int]] = {}
    for p, s in edges:
        adj.setdefault(p, []).append(s)
    # цикл з'явиться, якщо з successor вже можна дійти до predecessor
    stack, seen = [successor_id], {successor_id}
    while stack:
        node = stack.pop()
        if node == predecessor_id:
            return True
        for nxt in adj.get(node, []):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return False


def _topological_order(ids: List[int], succ_map: Dict[int, List[int]]) -> List[int]:
    """Топологічний порядок (Kahn). Вузли поза порядком (цикл) додаються наприкінці."""
    indeg = {i: 0 for i in ids}
    for p, ss in succ_map.items():
        for s in ss:
            if s in indeg:
                indeg[s] += 1
    queue = [i for i in ids if indeg[i] == 0]
    order = []
    while queue:
        node = queue.pop(0)
        order.append(node)
        for s in succ_map.get(node, []):
            if s in indeg:
                indeg[s] -= 1
                if indeg[s] == 0:
                    queue.append(s)
    for i in ids:
        if i not in order:
            order.append(i)
    return order


def _downstream(start: int, succ_map: Dict[int, List[int]]) -> Set[int]:
    seen: Set[int] = set()
    stack = list(succ_map.get(start, []))
    while stack:
        node = stack.pop()
        if node in seen or node == start:
            continue
        seen.add(node)
        stack.extend(succ_map.get(node, []))
    return seen


# ---------- Аналіз ризиків ----------
def analyze_dependencies(items: Dict[int, dict], deps: List[dict]):
    """Стани залежностей між елементами одного виду (віхи АБО тікети).

    items: {id: {"status", "start_date", "due_date"}}
    deps : [{"id", "type", "predecessor_id", "successor_id"}]
    Повертає {dep_id: {"state", "schedule_conflict"}} — залежності, чиї
    кінці відсутні в items, пропускаються.
    """
    result = {}
    for d in deps:
        pred = items.get(d["predecessor_id"])
        succ = items.get(d["successor_id"])
        if pred is None or succ is None:
            continue
        result[d["id"]] = {
            "state": dependency_state(d["type"], pred["status"], succ["status"]),
            "schedule_conflict": schedule_conflict(d["type"], pred, succ),
        }
    return result


def blocked_ids(items: Dict[int, dict], deps: List[dict], dep_info: dict) -> Dict[int, List[int]]:
    """{id: [ids попередників, що блокують старт]} — лише незавершені елементи."""
    blocked: Dict[int, List[int]] = {}
    for d in deps:
        info = dep_info.get(d["id"])
        if not info or info["state"] != STATE_WAITING or not blocks_start(d["type"]):
            continue
        succ = items.get(d["successor_id"])
        if succ is None or succ["status"] == STATUS_DONE:
            continue
        blocked.setdefault(d["successor_id"], []).append(d["predecessor_id"])
    return blocked


def analyze_milestones(milestones: Dict[int, dict], deps: List[dict], today: Optional[date] = None):
    """Повний аналіз ризиків макро-блоків.

    milestones: {id: {"status","progress","start_date","due_date"}}
    deps      : залежності між віхами
    Повертає (per_milestone, per_dependency):
      per_milestone[id] = {risk_level, risk_reasons, blocked_by, is_blocked,
                           downstream_count, is_bottleneck}
      per_dependency[id] = {state, schedule_conflict}
    """
    today = today or date.today()
    dep_info = analyze_dependencies(milestones, deps)
    blocked = blocked_ids(milestones, deps, dep_info)

    ids = list(milestones.keys())
    succ_map: Dict[int, List[int]] = {}
    pred_map: Dict[int, List[int]] = {}
    for d in deps:
        if d["predecessor_id"] in milestones and d["successor_id"] in milestones:
            succ_map.setdefault(d["predecessor_id"], []).append(d["successor_id"])
            pred_map.setdefault(d["successor_id"], []).append(d["predecessor_id"])

    # базові причини ризику кожного блоку
    base: Dict[int, dict] = {}
    for mid, m in milestones.items():
        reasons: List[str] = []
        if m["status"] != STATUS_DONE:
            due = m.get("due_date")
            if due is not None and due < today:
                reasons.append("overdue")
            elif (due is not None and (due - today).days <= DUE_SOON_DAYS
                  and (m.get("progress") or 0) < DUE_SOON_MAX_PROGRESS):
                reasons.append("due_soon")
            incoming = [d for d in deps if d["successor_id"] == mid and d["id"] in dep_info]
            if any(dep_info[d["id"]]["state"] == STATE_VIOLATED for d in incoming):
                reasons.append("violated")
            if any(dep_info[d["id"]]["schedule_conflict"] for d in incoming):
                reasons.append("schedule_conflict")
        base[mid] = {"reasons": reasons,
                     "danger": "overdue" in reasons or "violated" in reasons}

    # «зараження» вниз по ланцюжку: небезпечний блок робить ризиковими нащадків
    tainted: Dict[int, bool] = {}
    upstream: Dict[int, bool] = {}
    for mid in _topological_order(ids, succ_map):
        if milestones[mid]["status"] == STATUS_DONE:
            tainted[mid] = False
            upstream[mid] = False
            continue
        up = any(tainted.get(p, False) for p in pred_map.get(mid, [])
                 if milestones[p]["status"] != STATUS_DONE)
        upstream[mid] = up
        tainted[mid] = base[mid]["danger"] or up

    per_milestone = {}
    for mid, m in milestones.items():
        if m["status"] == STATUS_DONE:
            per_milestone[mid] = {
                "risk_level": RISK_NONE, "risk_reasons": [], "blocked_by": [],
                "is_blocked": False, "downstream_count": 0, "is_bottleneck": False,
            }
            continue
        reasons = list(base[mid]["reasons"])
        if upstream.get(mid):
            reasons.append("upstream_risk")
        if base[mid]["danger"]:
            level = RISK_DANGER
        elif reasons:
            level = RISK_WARNING
        else:
            level = RISK_NONE
        downstream = [x for x in _downstream(mid, succ_map)
                      if milestones[x]["status"] != STATUS_DONE]
        per_milestone[mid] = {
            "risk_level": level,
            "risk_reasons": reasons,
            "blocked_by": blocked.get(mid, []),
            "is_blocked": bool(blocked.get(mid)),
            "downstream_count": len(downstream),
            "is_bottleneck": level != RISK_NONE and len(downstream) >= BOTTLENECK_MIN_DOWNSTREAM,
        }
    return per_milestone, dep_info
