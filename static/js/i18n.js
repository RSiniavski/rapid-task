/* ============================================================
   Rapid Task — i18n (укр/англ)
   Використання:
     <span data-i18n="hero.title"></span>
     <input data-i18n-placeholder="auth.email">
   ============================================================ */

const I18N = {
  uk: {
    // хедер
    "nav.features": "Можливості",
    "nav.how": "Як це працює",
    "auth.login": "Увійти",
    "auth.register": "Реєстрація",
    "auth.logout": "Вийти",
    "lang.switch": "Мова",

    // hero
    "hero.badge": "Kanban-борди для команд",
    "hero.title": "Керуй задачами швидко",
    "hero.subtitle": "Rapid Task — сервіс для управління проектами та тікетами: гнучкі kanban-борди, ролі учасників, типи задач і жива аналітика. Без зайвих налаштувань — створив проект і працюй.",
    "hero.cta.start": "Почати безкоштовно",
    "hero.cta.more": "Дізнатись більше",

    // можливості
    "features.title": "Що всередині",
    "features.subtitle": "Все необхідне для роботи команди над проектом — і нічого зайвого.",
    "features.f1.title": "Проекти та борди",
    "features.f1.text": "Кожен проект — окрема kanban-борда зі своїми колонками, тікетами та командою.",
    "features.f2.title": "Гнучкі колонки",
    "features.f2.text": "Додавайте, перейменовуйте та переставляйте колонки під свій процес. Кількість не обмежена.",
    "features.f3.title": "Ролі та доступи",
    "features.f3.text": "Адмін, редактор, виконавець, репортер — кожен бачить і робить рівно те, що йому дозволено.",
    "features.f4.title": "Аналітика",
    "features.f4.text": "Кількість тікетів, співвідношення типів і середній час життя задачі — на дашборді.",
    "features.f5.title": "Типи тікетів",
    "features.f5.text": "Ідея, епік, задача, підзадача, баг, інцидент — з кольорами та іконками, як у зрілих трекерах.",
    "features.f6.title": "Темна тема",
    "features.f6.text": "Приємні пастельні відтінки, що не ріжуть очі навіть уночі.",

    // як це працює
    "how.title": "Як це працює",
    "how.subtitle": "Три кроки від реєстрації до першого закритого тікета.",
    "how.step1.title": "Створи проект",
    "how.step1.text": "Обери назву та ключ — борда з типовими колонками з'явиться автоматично.",
    "how.step2.title": "Запроси команду",
    "how.step2.text": "Додай учасників за email та задай роль кожному.",
    "how.step3.title": "Працюй з тікетами",
    "how.step3.text": "Створюй, призначай, переміщуй по колонках — аналітика рахується сама.",

    // форми авторизації
    "auth.tab.login": "Увійти",
    "auth.tab.register": "Реєстрація",
    "auth.email": "Email",
    "auth.password": "Пароль",
    "auth.full_name": "Ім'я",
    "auth.login.btn": "Увійти",
    "auth.register.btn": "Створити акаунт",
    "auth.error": "Помилка: спробуйте ще раз",

    // футер
    "footer.about.title": "Про сервіс",
    "footer.about.text": "Rapid Task — інструмент управління задачами для команд будь-якого розміру.",
    "footer.links.title": "Посилання",
    "footer.docs": "Документація API",
    "footer.landing": "Головна",
    "footer.contact.title": "Контакти",
    "footer.rights": "Всі права захищені.",
    "footer.made_with": "Зроблено з ❤️ для команд",
    "footer.donate": "Донат",
    "footer.donate_info": "☕ Підтримати проєкт — донат на каву",

    // підтримка / донат
    "support.title": "Допоможи Rapid Task жити далі",
    "support.text": "Подобається проєкт? Пригости автора кавою — це допомагає з хостингом, інтернетом та іншим.",
    "support.btn": "Донат на каву",
    "support.note": "Добровільна підтримка. Продукт безкоштовний.",
    "donate.page_title": "Донат",
    "donate.back": "← На головну",
    "donate.heading.1": "Small teams.",
    "donate.heading.2": "Big things.",
    "donate.text": "Rapid Task допомагає малим командам і незалежним творцям організовувати роботу, рухатись швидше та будувати важливе — без зайвої складності й високих витрат.",
    "donate.methods.title": "Обери зручний спосіб підтримки",
    "donate.methods.subtitle": "Добровільна підтримка. Продукт безкоштовний — донат допомагає з хостингом, інтернетом та розвитком.",
    "donate.paypal.desc": "Міжнародні платежі карткою або з балансу PayPal.",
    "donate.payoneer.desc": "Переказ через Payoneer для міжнародних платежів.",
    "donate.monobank.desc": "Банка monobank — швидко з української картки.",
    "donate.btn": "Підтримати",
    "donate.thanks": "Дякуємо, що допомагаєте Rapid Task рости ❤️",

    // загальні
    "common.loading": "Завантаження...",
    "common.cancel": "Скасувати",
    "common.save": "Зберегти",
    "common.close": "Закрити",
    "common.delete": "Видалити",
    "common.add": "Додати",
    "common.back": "Назад",

    // дашборд
    "dash.title": "Панель керування",
    "dash.welcome": "Вітаємо",
    "dash.stats.projects": "Проектів",
    "dash.stats.tickets": "Тікетів всього",
    "dash.stats.open": "Відкритих",
    "dash.stats.avg": "Сер. час життя тікета",
    "dash.stats.hours": "год",
    "dash.stats.no_data": "—",
    "dash.projects.title": "Мої проекти",
    "dash.projects.empty_title": "Ще немає проектів",
    "dash.projects.empty_text": "Створи перший проект — борда з типовими колонками з'явиться автоматично.",
    "dash.projects.create": "＋ Новий проект",
    "dash.open_board": "Відкрити борду",
    "dash.settings": "Налаштування",
    "dash.tickets_open": "відкритих",
    "dash.tickets_done": "закритих",

    // створення проекту
    "dash.create.title": "Новий проект",
    "dash.create.name": "Назва проекту",
    "dash.create.key": "Ключ (префікс тікетів)",
    "dash.create.key_hint": "Великі латинські літери/цифри, напр. OBD — тікети матимуть ключі OBD-1, OBD-2...",
    "dash.create.lang": "Мова інтерфейсу проекту",
    "dash.create.submit": "Створити проект",

    // налаштування проекту (адмін)
    "dash.settings.title": "Налаштування проекту",
    "dash.settings.tab_columns": "Колонки",
    "dash.settings.tab_members": "Учасники",
    "dash.settings.add_column": "Нова колонка",
    "dash.settings.column_name": "Назва колонки",
    "dash.settings.is_done": "Закриваюча колонка",
    "dash.settings.move_up": "Вище",
    "dash.settings.move_down": "Нижче",
    "dash.settings.move_tickets_to": "Перенести тікети в",
    "dash.settings.delete_confirm": "Видалити проект? Дію не можна відмінити.",
    "dash.settings.owner": "Власник",

    // учасники
    "dash.members.add": "Додати учасника",
    "dash.members.email": "Email користувача",
    "dash.members.role": "Роль",
    "dash.members.you": "(ви)",

    // ролі
    "role.admin": "Повний доступ",
    "role.editor": "Редактор (без видалення)",
    "role.contributor": "Виконавець (свої/призначені)",
    "role.reporter": "Репортер (тільки створення)",

    // типи тікетів
    "type.Idea": "Ідея",
    "type.Epic": "Епік",
    "type.Task": "Задача",
    "type.Subtask": "Підзадача",
    "type.Bug": "Баг",
    "type.Incident": "Інцидент",

    // помилки
    "dash.error.load": "Не вдалося завантажити дані",

    // борда
    "board.new_ticket": "＋ Новий тікет",
    "ticket.title": "Назва",
    "ticket.type": "Тип",
    "ticket.description": "Опис",
    "ticket.status": "Статус",
    "ticket.author": "Автор",
    "ticket.assignee": "Виконавець",
    "ticket.tester": "Тестувальник",
    "ticket.create": "Створити тікет",
    "ticket.readonly": "У вас немає прав на редагування цього тікета",
    "ticket.parent": "Батьківський тікет",
    "ticket.quick_subtask": "Швидка підзадача (тип · назва · виконавець)",
    "ticket.desc_placeholder": "Натисніть, щоб додати опис",
    "ticket.desc_edit_hint": "Натисніть, щоб редагувати опис",
    "ticket.desc_textarea": "Опис тікета. Файли можна вставити з буфера або перетягнути сюди",
    "ticket.attach": "📎 Прикріпити файл",
    "ticket.attachments": "Файли",
    "ticket.uploading": "Завантаження…",
    "ticket.attach_hint": "Щоб вставити зображення чи відео в текст опису, спершу клікніть по опису — файл з'явиться в місці курсора",
    "ticket.attach_remove": "Видалити файл",
    "ticket.subtasks": "Підзадачі",
    "ticket.subtask_add": "Додати підзадачу",
    "ticket.subtask_title": "Назва підзадачі",
    "ticket.subtask_remove": "Прибрати",

    // особистий кабінет
    "profile.open": "Особистий кабінет",
    "profile.title": "Особистий кабінет",
    "profile.email": "Email",
    "profile.name": "Ім'я",
    "profile.position": "Посада",
    "profile.position_placeholder": "Напр. Backend-розробник",
    "profile.avatar_set": "Встановити аватар",
    "profile.avatar_change": "Змінити аватар",
    "profile.avatar_remove": "Видалити",
    "profile.avatar_hint": "PNG, JPEG, GIF або WebP, до 5 МБ",
    "profile.saved": "Збережено",
    "profile.name_required": "Вкажіть ім'я",
  },

  en: {
    "nav.features": "Features",
    "nav.how": "How it works",
    "auth.login": "Log in",
    "auth.register": "Sign up",
    "auth.logout": "Log out",
    "lang.switch": "Language",

    "hero.badge": "Kanban boards for teams",
    "hero.title": "Manage tasks, fast",
    "hero.subtitle": "Rapid Task is a project and ticket management service: flexible kanban boards, member roles, task types and live analytics. No setup overhead — create a project and go.",
    "hero.cta.start": "Get started free",
    "hero.cta.more": "Learn more",

    "features.title": "What's inside",
    "features.subtitle": "Everything a team needs to ship work — nothing extra.",
    "features.f1.title": "Projects & boards",
    "features.f1.text": "Each project is its own kanban board with columns, tickets and a team.",
    "features.f2.title": "Flexible columns",
    "features.f2.text": "Add, rename and reorder columns to fit your process. No limits.",
    "features.f3.title": "Roles & permissions",
    "features.f3.text": "Admin, editor, contributor, reporter — everyone sees and does exactly what they're allowed to.",
    "features.f4.title": "Analytics",
    "features.f4.text": "Ticket counts, type breakdown and average ticket lifetime — right on the dashboard.",
    "features.f5.title": "Ticket types",
    "features.f5.text": "Idea, epic, task, subtask, bug, incident — with colors and icons, like mature trackers.",
    "features.f6.title": "Dark theme",
    "features.f6.text": "Soft pastel shades that are easy on the eyes, day and night.",

    "how.title": "How it works",
    "how.subtitle": "Three steps from sign-up to your first closed ticket.",
    "how.step1.title": "Create a project",
    "how.step1.text": "Pick a name and a key — a board with default columns appears instantly.",
    "how.step2.title": "Invite the team",
    "how.step2.text": "Add members by email and assign each one a role.",
    "how.step3.title": "Work the tickets",
    "how.step3.text": "Create, assign, move across columns — the analytics update themselves.",

    "auth.tab.login": "Log in",
    "auth.tab.register": "Sign up",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.full_name": "Name",
    "auth.login.btn": "Log in",
    "auth.register.btn": "Create account",
    "auth.error": "Error: please try again",

    "footer.about.title": "About",
    "footer.about.text": "Rapid Task — task management for teams of any size.",
    "footer.links.title": "Links",
    "footer.docs": "API documentation",
    "footer.landing": "Home",
    "footer.contact.title": "Contacts",
    "footer.rights": "All rights reserved.",
    "footer.made_with": "Made with ❤️ for teams",
    "footer.donate": "Donate",
    "footer.donate_info": "☕ Support the project — buy me a coffee",

    // support / donate
    "support.title": "Keep Rapid Task going",
    "support.text": "Like the project? Buy the author a coffee — it helps with hosting, internet and more.",
    "support.btn": "Buy me a coffee",
    "support.note": "Voluntary support. The product is free to use.",
    "donate.page_title": "Donations",
    "donate.back": "← Back to home",
    "donate.heading.1": "Small teams.",
    "donate.heading.2": "Big things.",
    "donate.text": "Rapid Task helps small teams and independent creators organize their work, move faster and build what matters — without unnecessary complexity or high costs.",
    "donate.methods.title": "Choose a way to support",
    "donate.methods.subtitle": "Voluntary support. The product is free to use — donations help with hosting, internet and development.",
    "donate.paypal.desc": "International payments by card or PayPal balance.",
    "donate.payoneer.desc": "Transfer via Payoneer for international payments.",
    "donate.monobank.desc": "monobank jar — quick from a Ukrainian card.",
    "donate.btn": "Donate",
    "donate.thanks": "Thank you for helping Rapid Task grow ❤️",

    "common.loading": "Loading...",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.close": "Close",
    "common.delete": "Delete",
    "common.add": "Add",
    "common.back": "Back",

    // dashboard
    "dash.title": "Control panel",
    "dash.welcome": "Welcome",
    "dash.stats.projects": "Projects",
    "dash.stats.tickets": "Total tickets",
    "dash.stats.open": "Open tickets",
    "dash.stats.avg": "Avg ticket lifetime",
    "dash.stats.hours": "h",
    "dash.stats.no_data": "—",
    "dash.projects.title": "My projects",
    "dash.projects.empty_title": "No projects yet",
    "dash.projects.empty_text": "Create your first project — a board with default columns appears automatically.",
    "dash.projects.create": "＋ New project",
    "dash.open_board": "Open board",
    "dash.settings": "Settings",
    "dash.tickets_open": "open",
    "dash.tickets_done": "closed",

    "dash.create.title": "New project",
    "dash.create.name": "Project name",
    "dash.create.key": "Key (ticket prefix)",
    "dash.create.key_hint": "Uppercase latin letters/digits, e.g. OBD — tickets get keys OBD-1, OBD-2...",
    "dash.create.lang": "Project interface language",
    "dash.create.submit": "Create project",

    "dash.settings.title": "Project settings",
    "dash.settings.tab_columns": "Columns",
    "dash.settings.tab_members": "Members",
    "dash.settings.add_column": "New column",
    "dash.settings.column_name": "Column name",
    "dash.settings.is_done": "Closing column",
    "dash.settings.move_up": "Up",
    "dash.settings.move_down": "Down",
    "dash.settings.move_tickets_to": "Move tickets to",
    "dash.settings.delete_confirm": "Delete this project? This cannot be undone.",
    "dash.settings.owner": "Owner",

    "dash.members.add": "Add member",
    "dash.members.email": "User email",
    "dash.members.role": "Role",
    "dash.members.you": "(you)",

    "role.admin": "Full access",
    "role.editor": "Editor (no delete)",
    "role.contributor": "Contributor (own/assigned)",
    "role.reporter": "Reporter (create only)",

    "type.Idea": "Idea",
    "type.Epic": "Epic",
    "type.Task": "Task",
    "type.Subtask": "Subtask",
    "type.Bug": "Bug",
    "type.Incident": "Incident",

    "dash.error.load": "Failed to load data",

    // board
    "board.new_ticket": "＋ New ticket",
    "ticket.title": "Title",
    "ticket.type": "Type",
    "ticket.description": "Description",
    "ticket.status": "Status",
    "ticket.author": "Author",
    "ticket.assignee": "Assignee",
    "ticket.tester": "Tester",
    "ticket.create": "Create ticket",
    "ticket.readonly": "You don't have permission to edit this ticket",
    "ticket.parent": "Parent ticket",
    "ticket.quick_subtask": "Quick subtask (type · title · assignee)",
    "ticket.desc_placeholder": "Click to add a description",
    "ticket.desc_edit_hint": "Click to edit the description",
    "ticket.desc_textarea": "Ticket description. Paste or drop files here",
    "ticket.attach": "📎 Attach file",
    "ticket.attachments": "Files",
    "ticket.uploading": "Uploading…",
    "ticket.attach_hint": "To insert an image or video into the description text, click the description first — the file appears at the cursor",
    "ticket.attach_remove": "Remove file",
    "ticket.subtasks": "Subtasks",
    "ticket.subtask_add": "Add subtask",
    "ticket.subtask_title": "Subtask title",
    "ticket.subtask_remove": "Remove",

    // personal account
    "profile.open": "Personal account",
    "profile.title": "Personal account",
    "profile.email": "Email",
    "profile.name": "Name",
    "profile.position": "Position",
    "profile.position_placeholder": "E.g. Backend developer",
    "profile.avatar_set": "Set avatar",
    "profile.avatar_change": "Change avatar",
    "profile.avatar_remove": "Remove",
    "profile.avatar_hint": "PNG, JPEG, GIF or WebP, up to 5 MB",
    "profile.saved": "Saved",
    "profile.name_required": "Please enter a name",
  },
};

// мета типів тікетів: колір (CSS-змінна) та іконка
const TYPE_META = {
  Idea:     { colorVar: "--type-idea",     icon: "💡" },
  Epic:     { colorVar: "--type-epic",     icon: "📈" },
  Task:     { colorVar: "--type-task",     icon: "🎫" },
  Subtask:  { colorVar: "--type-subtask",  icon: "🏷️" },
  Bug:      { colorVar: "--type-bug",      icon: "🐞" },
  Incident: { colorVar: "--type-incident", icon: "⚠️" },
};

function typeMeta(type) {
  return TYPE_META[type] || { colorVar: "--text-3", icon: "🎫" };
}

function typeLabel(type) {
  return i18nGet(`type.${type}`);
}

function i18nGet(key) {
  const lang = localStorage.getItem("rt_lang") || "uk";
  return (I18N[lang] && I18N[lang][key]) || (I18N.uk[key]) || key;
}

function applyI18n(root = document) {
  const lang = localStorage.getItem("rt_lang") || "uk";
  document.documentElement.lang = lang;

  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = i18nGet(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = i18nGet(el.dataset.i18nPlaceholder);
  });

  // підсвітка активної мови в усіх перемикачах
  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
}

function setLang(lang) {
  if (!I18N[lang]) return;
  localStorage.setItem("rt_lang", lang);
  applyI18n();
}

// ініціалізація на кожній сторінці, що підключає цей файл
document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  });
});
