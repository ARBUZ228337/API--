# API Gateway with Analytics (Вариант E)

Сервис выдаёт пользователям API-ключи, проксирует запросы к внешнему API, ограничивает частоту
запросов, логирует каждый вызов (кто, когда, куда, время ответа, статус) и показывает аналитику на дашборде.

**Стек:** Node.js (Express) · React (Vite) · PostgreSQL · JWT · Jest + Supertest

## Архитектура

```
Клиент ──(JWT)──► /api/*   регистрация, вход, ключи, аналитика
Клиент ─(X-API-Key)► /proxy/* ─► [проверка ключа] ─► [rate limit] ─► [логирование] ─► внешний API (UPSTREAM_URL)
React SPA ──► /api/*
```

Ключевые решения:
- **Два вида аутентификации:** JWT (1 час) для людей и API-ключ (`X-API-Key`) для программных вызовов прокси.
- **Ключи хранятся в виде SHA-256-хеша**; полный ключ показывается один раз при создании. Отзыв ключа — `is_active = false`.
- **Rate limiting** — middleware с фиксированным окном (по умолчанию 60 запросов/мин на ключ), ответ `429` + `Retry-After`.
- **Логирование** — middleware пишет в `request_logs` после завершения ответа (`res.on('finish')`), не задерживая клиента.
- **Аналитика** считается агрегатными SQL-запросами (`COUNT`, `AVG`, `GROUP BY`, `date_trunc`) и только по ключам текущего пользователя.
- **Слой хранилища** (`src/store`) имеет реализации Postgres и in-memory; тесты работают без БД.
- Целевой адрес прокси задаётся в `UPSTREAM_URL`, клиент передаёт только путь — защита от SSRF.

## Схема БД

```
users(id PK, email UNIQUE, password_hash, created_at)
  └─< api_keys(id PK, user_id FK, name, key_hash UNIQUE, key_prefix, is_active, created_at)
        └─< request_logs(id PK, api_key_id FK, endpoint, method, status_code, response_time_ms, created_at)
```
Полный DDL: `backend/db/schema.sql`.

## REST API

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | /api/register | — | Регистрация (email, пароль ≥ 8 символов) |
| POST | /api/login | — | Возвращает JWT |
| GET/POST | /api/keys | JWT | Список / создание ключа |
| DELETE | /api/keys/:id | JWT | Отзыв ключа |
| GET | /api/analytics?hours=24 | JWT | Сводка, топ эндпоинтов, коды ответов, нагрузка по часам |
| ANY | /proxy/* | X-API-Key | Проксирование к `UPSTREAM_URL` |

## Запуск

```bash
# 1. База данных (схема применится автоматически)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env        # задайте JWT_SECRET
npm install
npm run dev                 # http://localhost:5000

# 3. Frontend
cd ../frontend
npm install
npm run dev                 # http://localhost:5173 (проксирует /api на :5000)
```

Без Docker: создайте БД PostgreSQL и выполните `psql -f backend/db/schema.sql`, поправьте `DATABASE_URL`.

Пример вызова прокси:
```bash
curl -H "X-API-Key: gw_..." http://localhost:5000/proxy/posts/1
```

## Тесты

```bash
cd backend && npm test
```
- Unit: валидация, генерация/хеширование ключей, rate limiter.
- Интеграционные: (1) регистрация → вход → ключи, ошибки валидации; (2) прокси → rate limit → аналитика → отзыв ключа, изоляция данных между пользователями.

## Git-процесс
Ветки `feature/*`, слияние через pull request в `main`, коммиты в формате `feat:`, `fix:`, `test:`, `docs:`.
