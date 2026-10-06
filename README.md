# Rapid Task

**Rapid Task** — це веб-застосунок для керування завданнями та тікетами на базі інтерактивної Kanban-дошки. Проєкт побудований на сучасному та швидкому фреймворку **FastAPI**, використовує **SQLite** через **SQLAlchemy ORM** для збереження даних та легкий фронтенд на **Alpine.js** + **Tailwind CSS**.

---

## 🚀 Швидкий запуск

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

Встановіть необхідні пакети:
```bash
pip install -r requirements.txt
```

### 3. Конфігурація середовища (опціонально)
Створіть файл `.env` у кореневій папці проєкту (за замовчуванням використовуються безпечні локальні налаштування):

```env
SECRET_KEY=your-super-secret-key-change-it-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

### 4. Запуск сервера розробки
Запустіть застосунок через `uvicorn`:

```bash
# Стандартний запуск з автоперезавантаженням (гаряче перезавантаження при зміні коду):
uvicorn app.main:app --reload

# Запуск із явним зазначенням хосту та порту:
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

---

## 🌐 Основні посилання та вебінтерфейс

Після запуску сервера застосунок доступний за такими адресами:

| Сторінка / Інструмент | Посилання | Опис |
| :--- | :--- | :--- |
| **Головна сторінка (Kanban UI)** | [http://localhost:8000/](http://localhost:8000/) | Інтерактивна Kanban-дошка з drag-and-drop, авторизацією та переглядом тікетів |
| **Swagger UI (Інтерактивна документація)** | [http://localhost:8000/docs](http://localhost:8000/docs) | Інтерактивна документація Swagger для тестування всіх API ендпоінтів |
| **ReDoc** | [http://localhost:8000/redoc](http://localhost:8000/redoc) | Альтернативна структурована документація API |
| **OpenAPI специфікація (JSON)** | [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json) | Сира OpenAPI v3 схема у форматі JSON |

---

## 📡 Огляд API Ендпоінтів

Усі захищені маршрути вимагають заголовок авторизації: `Authorization: Bearer <access_token>`.

### 🔐 1. Авторизація та акаунти (`/api/auth`)

| Метод | Ендпоінт | Опис | Авторизація |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/auth/register` | Реєстрація нового користувача | ❌ |
| `POST` | `/api/auth/login` | Вхід у систему та отримання JWT токена (`username`, `password`) | ❌ |
| `GET` | `/api/auth/me` | Отримання даних поточного авторизованого користувача | ✅ |
| `GET` | `/api/auth/users` | Отримання списку всіх користувачів | ✅ |
| `DELETE` | `/api/auth/users/{user_id}` | Видалення/деактивація користувача (`?hard_delete=false/true`) | ✅ |

---

### 👥 2. Керування користувачами (`/api/users`)

| Метод | Ендпоінт | Опис | Авторизація |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/users` | Отримання списку всіх користувачів | ✅ |
| `GET` | `/api/users/{user_id}` | Отримання інформації про користувача за його ID | ✅ |
| `POST` | `/api/users/{user_id}/deactivate` | Деактивація користувача (додає `(Deactivated)` до імені, блокує вхід, зберігає тікети та історію) | ✅ |
| `DELETE` | `/api/users/{user_id}` | **Видалення користувача:**<br>• `hard_delete=false` *(за замовчуванням)* — м'яка деактивація зі збереженням тікетів та історії.<br>• `hard_delete=true` — повне каскадне видалення для автотестів. | ✅ |

---

### 📋 3. Керування тікетами (`/api/tickets`)

| Метод | Ендпоінт | Опис | Авторизація |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/tickets` | Отримання списку всіх тікетів на дошці | ✅ |
| `POST` | `/api/tickets` | Створення нового тікета (`title`, `type`, `description`, `assignee_id`) | ✅ |
| `GET` | `/api/tickets/{ticket_id}` | Отримання повної інформації про тікет та історію за числовим ID | ✅ |
| `GET` | `/api/tickets/key/{ticket_key}` | Отримання тікета за ключем (наприклад, `RT-1`) | ✅ |
| `PUT` | `/api/tickets/{ticket_id}` | Оновлення тікета (статус, виконавець, опис, заголовок) із записом в історію | ✅ |
| `PATCH` | `/api/tickets/{ticket_id}/status` | Швидка зміна статусу тікета (використовується при перетягуванні на дошці) | ✅ |
| `DELETE` | `/api/tickets/{ticket_id}` | Повне видалення тікета за його числовим ID та очищення його історії | ✅ |
| `DELETE` | `/api/tickets/key/{ticket_key}` | Повне видалення тікета за його ключем (`RT-1`) та очищення його історії | ✅ |

---

## 🧪 Робота з API в автотестах (Clean-up & Teardown)

Для автоматизованих тестів реалізовано спеціальні можливості очищення даних без впливу на інтерфейс користувача:

1. **Очищення створеного тікета після тесту:**
   ```http
   DELETE /api/tickets/{ticket_id}
   Authorization: Bearer <token>
   ```
   *Або за ключем:*
   ```http
   DELETE /api/tickets/key/{ticket_key}
   Authorization: Bearer <token>
   ```

2. **Повне видалення тестового користувача та його тестових тікетів (Hard Delete):**
   ```http
   DELETE /api/users/{user_id}?hard_delete=true
   Authorization: Bearer <token>
   ```

3. **М'яка деактивація користувача (Business Deactivation):**
   ```http
   DELETE /api/users/{user_id}
   Authorization: Bearer <token>
   ```
   *(або `POST /api/users/{user_id}/deactivate`)*

---

## 🗄️ Структура проєкту

```text
rapid-task/
├── app/
│   ├── auth.py          # JWT аутентифікація та гешування паролів
│   ├── config.py        # Налаштування застосунку через Pydantic Settings
│   ├── crud.py          # Бізнес-логіка та взаємодія з базою даних (CRUD)
│   ├── database.py      # Підключення до бази даних SQLite та налаштування сесій
│   ├── main.py          # Точка входу FastAPI, підключення роутерів та статики
│   ├── models.py        # SQLAlchemy моделі (User, Ticket, TicketHistory)
│   ├── routers/         # Ендпоінти API
│   │   ├── auth.py      # Роутер авторизації (/api/auth)
│   │   ├── tickets.py   # Роутер тікетів (/api/tickets)
│   │   └── users.py     # Роутер користувачів (/api/users)
│   └── schemas.py       # Pydantic схеми валідації та серіалізації
├── static/              # Статичні файли фронтенду
│   ├── index.html       # Головна HTML сторінка застосунку
│   └── app.js           # Логіка клієнта на Alpine.js
├── rapid_task.db        # База даних SQLite
├── requirements.txt     # Залежності проєкту
└── README.md            # Документація проєкту
```
