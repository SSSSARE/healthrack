# HealthTrack — Backend Setup

## Структура проекта

```
healthtrack/
├── server.js          # Express backend (API + auth)
├── package.json       # Зависимости Node.js
├── healthtrack.db     # SQLite база данных (создаётся автоматически)
└── public/
    └── index.html     # Frontend с авторизацией
```

## Быстрый старт

### 1. Установка зависимостей

```bash
cd healthtrack
npm install
```

### 2. Запуск сервера

```bash
npm start
```

Сервер запустится на **http://localhost:3000**

### 3. Открыть в браузере

```
http://localhost:3000
```

---

## API Endpoints

### Авторизация

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход |
| GET  | `/api/auth/me` | Текущий пользователь |
| PUT  | `/api/auth/profile` | Обновить профиль |

### Данные (требуют JWT токен)

| Метод | URL | Описание |
|-------|-----|----------|
| GET  | `/api/data` | Все данные пользователя |
| POST | `/api/weights` | Добавить вес |
| DELETE | `/api/weights/:id` | Удалить запись |
| POST | `/api/foods` | Добавить питание |
| DELETE | `/api/foods/:id` | Удалить запись |
| POST | `/api/bp` | Добавить давление |
| DELETE | `/api/bp/:id` | Удалить запись |
| POST | `/api/activities` | Добавить тренировку |
| DELETE | `/api/activities/:id` | Удалить запись |
| PUT  | `/api/settings` | Обновить настройки |

### Пример запроса (login)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"user@mail.ru","password":"mypassword"}'
```

### Пример запроса с токеном

```bash
curl http://localhost:3000/api/data \
  -H "Authorization: Bearer <ваш_токен>"
```

---

## Технологии

- **Node.js + Express** — веб-сервер
- **SQLite (better-sqlite3)** — база данных (файл `healthtrack.db`)
- **JWT** — авторизация (токен живёт 7 дней)
- **bcryptjs** — хеширование паролей

## Для продакшена

1. Смените `JWT_SECRET` на случайную строку:
   ```bash
   export JWT_SECRET="ваш-секретный-ключ-минимум-32-символа"
   ```

2. Настройте HTTPS (nginx / Let's Encrypt)

3. Установите `PORT`:
   ```bash
   export PORT=8080
   npm start
   ```
