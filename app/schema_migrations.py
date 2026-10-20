"""Легкі міграції SQLite без залежностей (лише stdlib), щоб їх можна було тестувати окремо.

`Base.metadata.create_all` не змінює вже наявні таблиці. Якщо в БД лишилась таблиця
`milestones` зі СТАРОЇ структури (рання чернетка Roadmap: `color`, `position_x`, `position_y`
замість `progress`, `pos_x`, `pos_y`), то будь-який запит до неї падає з
«no such column» (HTTP 500), а старі NOT NULL-колонки без значень за замовчуванням
блокують вставку нових віх. Тут така таблиця перебудовується під поточну модель
із перенесенням даних.

`conn` — будь-який об'єкт з методом `exec_driver_sql(sql)` (SQLAlchemy Connection),
`create_table(conn)` створює таблицю milestones за актуальною моделлю.
"""

# Має збігатися зі стовпцями models.Milestone (перевіряє tests/test_schema_migrations.py)
MILESTONE_COLUMNS = (
    "id", "project_id", "title", "description", "start_date", "due_date",
    "status", "progress", "pos_x", "pos_y", "created_at",
)

_DONE = "('done','completed','closed')"
_IN_PROGRESS = "('in_progress','active')"


def _columns(conn, table):
    return [row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()]


def _table_exists(conn, name):
    return bool(conn.exec_driver_sql(
        f"SELECT 1 FROM sqlite_master WHERE type='table' AND name='{name}'").fetchall())


def _free_legacy_name(conn):
    name, n = "milestones_legacy", 1
    while _table_exists(conn, name):
        n += 1
        name = f"milestones_legacy_{n}"
    return name


def migrate_legacy_milestones(conn, create_table) -> bool:
    """Перебудовує `milestones`, якщо її стовпці не збігаються з MILESTONE_COLUMNS.

    Повертає True, якщо таблицю перебудовано. Якщо переносити дані не можна
    (немає id/project_id/title), стара таблиця лишається під ім'ям milestones_legacy*,
    нічого не губиться.
    """
    cols = _columns(conn, "milestones")
    if not cols or set(cols) == set(MILESTONE_COLUMNS):
        return False
    have = set(cols)

    # імена індексів глобальні — без цього створення нової таблиці впаде на дублікаті
    for (index_name,) in conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='milestones' AND sql IS NOT NULL").fetchall():
        conn.exec_driver_sql(f'DROP INDEX "{index_name}"')

    legacy = _free_legacy_name(conn)
    conn.exec_driver_sql(f'ALTER TABLE milestones RENAME TO "{legacy}"')
    create_table(conn)

    if not {"id", "project_id", "title"} <= have:
        return True  # дані не перенесено, стара таблиця збережена

    def date_of(col):
        return f"substr({col}, 1, 10)" if col in have else "NULL"

    def first(*names):
        present = [n for n in names if n in have]
        if not present:
            return "NULL"
        # COALESCE у SQLite потребує щонайменше 2 аргументів
        return present[0] if len(present) == 1 else f"COALESCE({', '.join(present)})"

    status = f"lower({'status'})" if "status" in have else "'planned'"
    status_sql = (f"CASE WHEN {status} IN {_DONE} THEN 'done' "
                  f"WHEN {status} IN {_IN_PROGRESS} THEN 'in_progress' ELSE 'planned' END")
    if "progress" in have:
        progress_sql = "MAX(0, MIN(100, COALESCE(progress, 0)))"
    else:
        progress_sql = f"CASE WHEN {status} IN {_DONE} THEN 100 ELSE 0 END"

    conn.exec_driver_sql(
        "INSERT INTO milestones (id, project_id, title, description, start_date, due_date, "
        "status, progress, pos_x, pos_y, created_at) "
        f"SELECT id, project_id, title, {first('description')}, {date_of('start_date')}, "
        f"{date_of('due_date')}, {status_sql}, {progress_sql}, "
        f"{first('pos_x', 'position_x')}, {first('pos_y', 'position_y')}, {first('created_at')} "
        f'FROM "{legacy}"')
    conn.exec_driver_sql(f'DROP TABLE "{legacy}"')
    return True
