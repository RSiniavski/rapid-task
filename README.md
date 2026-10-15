# Rapid Task

**Rapid Task** — веб-застосунок для керування проєктами та тікетами на базі інтерактивних Kanban-борд. Бекенд на **FastAPI** + **SQLite** (**SQLAlchemy ORM**), фронтенд на **Vue 3** з власною темою CSS, drag-and-drop через **Sortable.js**, двомовний інтерфейс (UK/EN).

---

## Можливості

* Кілька проєктів — у кожного своя борда, колонки та префікс ключів тікетів (`OBD-1`, `OBD-2`…)
* Ролі учасників: **admin**, **editor**, **contributor**, **reporter**
* Гнучкі колонки (додавання, перейменування, перестановка, колонка «Done» для метрик)
* Типи тікетів: Idea, Epic, Task, Subtask, Bug, Incident — з ієрархією parent/child
* Дашборд зі статистикою та налаштуваннями проєкту
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

`POST /api/tickets/project/{project_id}` додатково приймає `subtasks` (список `{title, type, assignee_id}` —
підзадачі створюються разом з тікетом) та `attachment_ids` (файли, завантажені до створення тікета).

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
│   ├── database.py        # SQLite engine і сесії, ensure_schema() — легка міграція users
│   ├── files.py           # Збереження/віддача завантажених файлів (аватари, вкладення)
│   ├── main.py            # FastAPI app, роутери, статика, /uploads
│   ├── models.py          # User, Project, ProjectMember, BoardColumn, Ticket, TicketHistory, TicketAttachment
│   ├── schemas.py         # Pydantic-схеми запитів/відповідей
│   └── routers/
│       ├── auth.py        # /api/auth
│       ├── users.py       # /api/users
│       ├── attachments.py # /api/attachments
│       ├── projects.py    # /api/projects (проєкти, учасники, колонки, статистика)
│       └── tickets.py     # /api/tickets
├── static/
│   ├── index.html         # Лендінг + модалки входу/реєстрації
│   ├── dashboard.html     # Панель керування проєктами
│   ├── board.html         # Kanban-борда проєкту
│   ├── css/
│   │   └── theme.css      # Тема, layout, компоненти UI
│   └── js/
│       ├── api.js         # HTTP-клієнт до API
│       ├── i18n.js        # Локалізація UK/EN + метатипів тікетів
│       ├── shared.js      # Спільні Vue-компоненти: аватар, вибір користувача, особистий кабінет, вкладення
│       ├── landing.js     # Логіка лендінгу
│       ├── dashboard.js   # Vue-додаток дашборду
│       └── board.js       # Vue-додаток борди + Sortable
├── rapid_task.db          # База даних SQLite (створюється при запуску)
├── uploads/               # Завантажені файли (створюється при запуску, не комітиться)
├── requirements.txt
└── README.md
```
