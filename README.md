# Rapid Task

**Rapid Task** — веб-застосунок для керування проєктами та тікетами на базі інтерактивних Kanban-борд. Бекенд на **FastAPI** + **SQLite** (**SQLAlchemy ORM**), фронтенд на **Vue 3** з власною темою CSS, drag-and-drop через **Sortable.js**, двомовний інтерфейс (UK/EN).

---

## Можливості

* Кілька проєктів — у кожного своя борда, колонки та префікс ключів тікетів (`OBD-1`, `OBD-2`…)
* Ролі учасників: **admin**, **editor**, **contributor**, **reporter**
* Гнучкі колонки (додавання, перейменування, перестановка, колонка «Done» для метрик)
* Типи тікетів: Idea, Epic, Task, Subtask, Bug, Incident — з ієрархією parent/child
* Дашборд зі статистикою та налаштуваннями проєкту
* **Nested Dependency Roadmap** — інтерактивне полотно віх (macro-blocks) із залежностями, semantic zoom і drag-and-drop тікетів між віхами (див. [розділ нижче](#nested-dependency-roadmap))
* Сторінка добровільної підтримки проєкту (`/donate.html`: PayPal, Payoneer, monobank) і банер «Донат на каву» на лендінгу
* JWT-авторизація, темна тема, локалізація UK/EN

---

## Швидкий запуск

### 1. Вимоги
* Python **3.10+**
* Менеджер пакетів `pip`

### 2. Встановлення залежностей
Створіть та активуйте віртуальне середовище:

```bash
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1

# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
```

Встановіть пакети:
```bash
pip install -r requirements.txt
```

### 3. Конфігурація середовища (опціонально)
Створіть файл `.env` у корені проєкту (за замовчуванням — безпечні локальні значення):

```env
SECRET_KEY=your-super-secret-key-change-it-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

### 4. Запуск сервера розробки

```bash
uvicorn app.main:app --reload

# або з явним хостом/портом:
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

---

## Основні посилання

| Сторінка / Інструмент | Посилання | Опис |
| :--- | :--- | :--- |
| **Лендінг** | [http://localhost:8000/](http://localhost:8000/) | Головна сторінка, реєстрація та вхід |
| **Панель керування** | [http://localhost:8000/dashboard.html](http://localhost:8000/dashboard.html) | Проєкти, статистика, налаштування |
| **Kanban-борда** | [http://localhost:8000/board.html?project=\<id\>](http://localhost:8000/board.html) | Борда конкретного проєкту |
| **Roadmap** | [http://localhost:8000/roadmap.html?project=\<id\>](http://localhost:8000/roadmap.html) | Полотно віх і залежностей проєкту |
| **Донат** | [http://localhost:8000/donate.html](http://localhost:8000/donate.html) | Сторінка підтримки проєкту (відкривається в новій вкладці) |
| **Swagger UI** | [http://localhost:8000/docs](http://localhost:8000/docs) | Інтерактивна документація API |
| **ReDoc** | [http://localhost:8000/redoc](http://localhost:8000/redoc) | Альтернативна документація API |
| **OpenAPI JSON** | [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json) | OpenAPI v3 схема |

Захищені маршрути потребують заголовок: `Authorization: Bearer <access_token>`.

---

## Огляд API

### Авторизація (`/api/auth`)

| Метод | Ендпоінт | Опис | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/auth/register` | Реєстрація користувача | ❌ |
| `POST` | `/api/auth/login` | Вхід, отримання JWT (`username`, `password`) | ❌ |
| `GET` | `/api/auth/me` | Поточний користувач | ✅ |
| `GET` | `/api/auth/users` | Список користувачів | ✅ |
| `DELETE` | `/api/auth/users/{user_id}` | Видалення/деактивація (`?hard_delete=false/true`) | ✅ |

### Користувачі (`/api/users`)

| Метод | Ендпоінт | Опис | Auth |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/users` | Список користувачів | ✅ |
| `PATCH` | `/api/users/me` | Оновити свій профіль (`full_name`, `position`) | ✅ |
| `POST` | `/api/users/me/avatar` | Завантажити аватар (`multipart`, PNG/JPEG/GIF/WebP, до 5 МБ) | ✅ |
| `DELETE` | `/api/users/me/avatar` | Видалити аватар | ✅ |
| `GET` | `/api/users/{user_id}` | Користувач за ID | ✅ |
| `POST` | `/api/users/{user_id}/deactivate` | М’яка деактивація | ✅ |
| `DELETE` | `/api/users/{user_id}` | Деактивація або hard delete (`?hard_delete=true`) | ✅ |

### Проєкти (`/api/projects`)

| Метод | Ендпоінт | Опис | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/projects` | Створити проєкт (`name`, `key`, `language`) | ✅ |
| `GET` | `/api/projects` | Список проєктів поточного користувача | ✅ |
| `GET` | `/api/projects/dashboard` | Зведена статистика для дашборду | ✅ |
| `GET` | `/api/projects/{project_id}` | Деталі проєкту (колонки, учасники) | ✅ |
| `PATCH` | `/api/projects/{project_id}` | Оновити назву / мову | ✅ |
| `DELETE` | `/api/projects/{project_id}` | Видалити проєкт | ✅ |
| `GET` | `/api/projects/{project_id}/members` | Учасники | ✅ |
| `POST` | `/api/projects/{project_id}/members` | Додати учасника | ✅ |
| `PATCH` | `/api/projects/{project_id}/members/{user_id}` | Змінити роль | ✅ |
| `DELETE` | `/api/projects/{project_id}/members/{user_id}` | Прибрати учасника | ✅ |
| `GET` | `/api/projects/{project_id}/columns` | Колонки борди | ✅ |
| `POST` | `/api/projects/{project_id}/columns` | Створити колонку | ✅ |
| `PATCH` | `/api/projects/{project_id}/columns/{column_id}` | Оновити колонку | ✅ |
| `DELETE` | `/api/projects/{project_id}/columns/{column_id}` | Видалити колонку (`?move_tickets_to=`) | ✅ |
| `GET` | `/api/projects/{project_id}/stats` | Статистика проєкту | ✅ |

### Тікети (`/api/tickets`)

| Метод | Ендпоінт | Опис | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/tickets/project/{project_id}` | Створити тікет у проєкті | ✅ |
| `GET` | `/api/tickets/project/{project_id}` | Список тікетів проєкту | ✅ |
| `GET` | `/api/tickets/{ticket_id}` | Тікет за ID | ✅ |
| `GET` | `/api/tickets/key/{ticket_key}` | Тікет за ключем (`OBD-1`) | ✅ |
| `PATCH` | `/api/tickets/{ticket_id}` | Оновити тікет | ✅ |
| `PATCH` | `/api/tickets/{ticket_id}/column` | Перемістити в іншу колонку (drag-and-drop) | ✅ |
| `DELETE` | `/api/tickets/{ticket_id}` | Видалити тікет | ✅ |

`POST`/`PATCH` тікета приймають також `milestone_id` — віха Roadmap, до якої належить тікет
(`null` у `PATCH` знімає тікет з віхи). Віха має належати тому ж проєкту, інакше `400`.

`POST /api/tickets/project/{project_id}` додатково приймає `subtasks` (список `{title, type, assignee_id}` —
підзадачі створюються разом з тікетом) та `attachment_ids` (файли, завантажені до створення тікета).

### Roadmap (`/api/roadmap`)

| Метод | Ендпоінт | Опис | Хто може |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/roadmap/project/{project_id}` | Повний знімок: віхи (прогрес, лічильники, ризики), залежності зі станами, заблоковані тікети | будь-який учасник |
| `POST` | `/api/roadmap/project/{project_id}/milestones` | Створити віху | admin, editor |
| `PATCH` | `/api/roadmap/milestones/{milestone_id}` | Змінити віху (назва, опис, дати; статус/прогрес — лише для віхи без тікетів) | admin, editor |
| `DELETE` | `/api/roadmap/milestones/{milestone_id}` | Видалити віху (тікети лишаються в проєкті, залежності віхи видаляються) | admin, editor |
| `POST` | `/api/roadmap/project/{project_id}/dependencies` | Створити залежність (`entity`: `milestone`/`ticket`, `predecessor_id`, `successor_id`, `type`: `FS`/`SS`/`FF`/`SF`) | admin, editor |
| `PATCH` | `/api/roadmap/dependencies/{dependency_id}` | Змінити тип залежності | admin, editor |
| `DELETE` | `/api/roadmap/dependencies/{dependency_id}` | Видалити залежність | admin, editor |
| `PUT` | `/api/roadmap/project/{project_id}/layout` | Зберегти позиції віх на полотні (`{"items": [{"id", "x", "y"}]}`) | admin, editor |

Помилки валідації повертаються як `400` з `detail`: залежність на себе, дублікат, **цикл**,
елемент з іншого проєкту, `due_date` раніше за `start_date`, ручна зміна статусу/прогресу віхи з тікетами.
Перенесення тікета між віхами виконується звичайним `PATCH /api/tickets/{id}` з `milestone_id`
(діють ті самі права редагування тікетів, що й на борді).

Підзадачі, створені разом із тікетом (`subtasks`), успадковують його `milestone_id`.

### Вкладення (`/api/attachments`)

| Метод | Ендпоінт | Опис | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/attachments?project_id=&ticket_id=` | Завантажити файл (`multipart`, до 25 МБ). Без `ticket_id` — файл для ще не створеного тікета | ✅ |
| `DELETE` | `/api/attachments/{attachment_id}` | Видалити вкладення | ✅ |
| `GET` | `/uploads/{file}` | Віддача файлу (аватари та вкладення) | — |

Файли зберігаються в каталозі `uploads/` під випадковими іменами. Зображення, відео, аудіо та PDF відкриваються
в браузері, решта типів (зокрема HTML/SVG) завжди завантажується. Зображення й відео в описі тікета
позначаються токеном `![назва](/uploads/<файл>)`.

---

## Nested Dependency Roadmap

Гібрид mind-map, kanban і таймлайну для стратегічного планування: на нескінченному полотні лежать
**віхи (macro-blocks)**, усередині яких — тікети проєкту, а між ними — стрілки залежностей.
Відкривається кнопкою **Roadmap** на картці проєкту (дашборд) або в шапці борди:
`/roadmap.html?project=<id>`.

### Модель даних
* **Milestone** — `title`, `description`, `start_date`, `due_date`, `status` (`planned` / `in_progress` / `done`),
  `progress` (0–100), `pos_x` / `pos_y` (позиція на полотні).
* **Ticket.milestone_id** — зв'язок «тікет → віха» (необов'язковий; тікети без віхи показуються в панелі *Backlog*).
* **RoadmapDependency** — залежність `predecessor → successor` між двома віхами **або** двома тікетами одного проєкту.
  Типи: `FS` (Finish-to-Start), `SS` (Start-to-Start), `FF` (Finish-to-Finish), `SF` (Start-to-Finish).
  Цикли відхиляються на сервері.

Нові таблиці створює `Base.metadata.create_all`, колонку `tickets.milestone_id` у вже наявній БД додає
`ensure_schema()` при старті — ручна міграція не потрібна, наявні дані не змінюються.

> **Стара таблиця `milestones`.** Якщо в БД лишилась таблиця зі структури ранньої чернетки Roadmap
> (колонки `color`, `position_x`, `position_y` замість `progress`, `pos_x`, `pos_y`), Roadmap відповідав би `500`
> (`no such column: milestones.progress`). Тепер `ensure_schema()` автоматично перебудовує її під поточну модель
> з перенесенням даних (`app/schema_migrations.py`); повторні запуски безпечні. Порожні таблиці зі старих
> чернеток `milestone_dependencies` та `ticket_dependencies` застосунок не використовує — їх можна видалити.

### Автоматичний прогрес і статус
Для віхи **з тікетами** прогрес і статус рахуються автоматично й перераховуються при кожній зміні
(переміщення тікета між колонками чи віхами, зміна колонки «Done», видалення тікета):

| Стан тікетів віхи | Статус | Прогрес |
| :--- | :--- | :--- |
| усі в першій колонці, жоден не закритий | `planned` | `0%` |
| є рух (поза першою колонкою) або закриті, але не всі | `in_progress` | `закриті / всього` |
| усі в колонці «Done» | `done` | `100%` |

Віха **без тікетів** керується вручну (статус і прогрес задаються у формі).
Спроба вручну змінити їх у віхи з тікетами повертає `400`.

### Ризики та вузькі місця
Для кожної незавершеної віхи сервер повертає `risk_level` (`none` / `warning` / `danger`) і `risk_reasons`:

* `overdue` (**danger**) — `due_date` минув, а віха не завершена;
* `violated` (**danger**) — наступник уже зробив те, що забороняє залежність (наприклад, стартував до завершення FS-попередника);
* `due_soon` (warning) — до дедлайну ≤ 7 днів, а прогрес < 50%;
* `schedule_conflict` (warning) — за календарем залежність не може бути виконана (наприклад, дедлайн попередника пізніше за старт наступника);
* `upstream_risk` (warning) — «зараження» вниз по ланцюжку: небезпечний блок робить ризиковими своїх нащадків.

Додатково: `is_blocked` / `blocked_by` — невиконані FS/SS-залежності, що не дають стартувати, а
`is_bottleneck` — ризикова віха, від якої залежать ≥ 2 незавершені віхи. Розрахунок — у чистому модулі
`app/roadmap_logic.py` (без БД), тому покритий unit-тестами.

### Робота з полотном
| Дія | Як |
| :--- | :--- |
| Переміщення полотна | перетягнути порожнє місце (мишею або пальцем) |
| Масштаб | колесо миші (з `Ctrl` / pinch на тачпаді — швидше), pinch двома пальцями, кнопки `−` `＋`, клавіші `+` `-` (коли полотно у фокусі); `0` — 100%; `F` або подвійний клік по порожньому — вписати все |
| Перемістити віху | перетягнути за заголовок (позиція зберігається на сервері; лише admin/editor) |
| Створити залежність | потягнути за круглу ручку на краю віхи (або тікета) до іншого елемента; клік по стрілці — змінити тип / видалити |
| Перенести тікет між віхами | перетягнути картку тікета на іншу віху або з панелі *Backlog* на віху; скинути на панель Backlog — зняти з віхи |
| Розкрити / згорнути віху | кнопка ▾ / ▸ у заголовку віхи (перекриває автоматичний рівень) |
| Авто-розкладка | кнопка *Auto layout* (шари зліва направо: колонка = довжина найдовшого ланцюжка залежностей до віхи; результат зберігається) |

**Semantic zoom** (залежить від масштабу, `static/js/roadmap-core.js`):

| Масштаб | Рівень | Що видно |
| :--- | :--- | :--- |
| < 45% | «Пташиний політ» | укрупнені назви, прогрес-бар із лічильником (`5/12 виконано`) і бейджі статусу/ризику; дати й опис приховані |
| 45–80% | Макро | звичайні блоки з датами й описом; внутрішні тікети «розчинені» — лишається консолідований прогрес |
| ≥ 80% | «Детальний огляд» | усередині віх з'являються картки тікетів |

Кнопка ▾ / ▸ у заголовку віхи розкриває чи згортає окрему віху незалежно від масштабу.
Масштаб — від 20% до 200%; позиція й масштаб полотна запам'ятовуються в браузері.
Кольори стрілок: зелена — умова залежності виконана, пунктирна жовта — очікує, червона — порушена.
Бейджі: 🔥 вузьке місце, 🔒 заблоковано, ⛔ критично, ⚠ ризик.

### Права доступу
* Переглядати Roadmap може будь-який учасник проєкту (інші користувачі отримують `403`).
* Створювати/змінювати/видаляти віхи й залежності та зберігати розкладку — **admin** і **editor**.
  Для інших ролей інтерфейс працює в режимі «тільки перегляд».
* Перенесення тікета між віхами підпорядковується звичайним правилам редагування тікетів.

---

## Тести

Unit-тести чистої логіки Roadmap (прогрес, стани залежностей, цикли, ризики, геометрія полотна, міграція БД)
не потребують БД, FastAPI чи сторонніх бібліотек:

```bash
python -m unittest discover -s tests -v     # бекенд-логіка (roadmap_logic.py) і міграція БД (schema_migrations.py)
node --test tests/roadmap-core.test.js      # ядро полотна (static/js/roadmap-core.js), Node.js 18+
```

Ручні та E2E-сценарії описано в [TEST_CASES.md](TEST_CASES.md).

---

## Налаштування сторінки донату

Посилання на платіжні системи лежать в одному місці — `static/js/donate.js` (об'єкт `DONATE_LINKS`).
Замініть заглушки `YOUR_PAYPAL_NAME`, `YOUR_PAYONEER_LINK`, `YOUR_JAR_ID` на свої PayPal.me, Payoneer-посилання
та банку monobank.

---

## Робота з API в автотестах (Clean-up)

1. **Видалити тікет після тесту:**
   ```http
   DELETE /api/tickets/{ticket_id}
   Authorization: Bearer <token>
   ```

2. **Hard delete тестового користувача:**
   ```http
   DELETE /api/users/{user_id}?hard_delete=true
   Authorization: Bearer <token>
   ```

3. **М’яка деактивація:**
   ```http
   DELETE /api/users/{user_id}
   Authorization: Bearer <token>
   ```
   *(або `POST /api/users/{user_id}/deactivate`)*

---

## Структура проєкту

```text
rapid-task/
├── app/
│   ├── auth.py            # JWT, гешування паролів, get_current_user
│   ├── config.py          # Pydantic Settings (.env)
│   ├── crud.py            # Бізнес-логіка та доступ до БД
│   ├── database.py        # SQLite engine і сесії, ensure_schema() — легка міграція (users, tickets.milestone_id)
│   ├── files.py           # Збереження/віддача завантажених файлів (аватари, вкладення)
│   ├── main.py            # FastAPI app, роутери, статика, /uploads
│   ├── models.py          # User, Project, ProjectMember, BoardColumn, Ticket, TicketHistory, TicketAttachment, Milestone, RoadmapDependency
│   ├── roadmap_logic.py   # Чиста логіка Roadmap: авто-прогрес, стани залежностей, цикли, ризики/вузькі місця
│   ├── schema_migrations.py # Міграція legacy-таблиці milestones (stdlib only, виклик з ensure_schema)
│   ├── schemas.py         # Pydantic-схеми запитів/відповідей
│   └── routers/
│       ├── auth.py        # /api/auth
│       ├── users.py       # /api/users
│       ├── attachments.py # /api/attachments
│       ├── projects.py    # /api/projects (проєкти, учасники, колонки, статистика)
│       ├── roadmap.py     # /api/roadmap (віхи, залежності, розкладка)
│       └── tickets.py     # /api/tickets
├── static/
│   ├── index.html         # Лендінг + модалки входу/реєстрації
│   ├── dashboard.html     # Панель керування проєктами
│   ├── board.html         # Kanban-борда проєкту
│   ├── roadmap.html       # Nested Dependency Roadmap (нескінченне полотно)
│   ├── donate.html        # Сторінка добровільної підтримки (PayPal, Payoneer, monobank)
│   ├── css/
│   │   └── theme.css      # Тема, layout, компоненти UI
│   └── js/
│       ├── api.js         # HTTP-клієнт до API
│       ├── i18n.js        # Локалізація UK/EN + метатипів тікетів
│       ├── shared.js      # Спільні Vue-компоненти: аватар, вибір користувача, особистий кабінет, вкладення
│       ├── landing.js     # Логіка лендінгу
│       ├── dashboard.js   # Vue-додаток дашборду
│       ├── board.js       # Vue-додаток борди + Sortable
│       ├── roadmap-core.js # Геометрія полотна: масштаб, semantic zoom, авто-розкладка (без DOM)
│       ├── roadmap.js     # Сторінка Roadmap: віхи, зв'язки, drag-and-drop (чистий JS)
│       └── donate.js      # Посилання на платіжні системи (DONATE_LINKS)
├── tests/                 # Unit-тести Roadmap (Python unittest + node:test)
├── rapid_task.db          # База даних SQLite (створюється при запуску)
├── uploads/               # Завантажені файли (створюється при запуску, не комітиться)
├── requirements.txt
└── README.md
```
