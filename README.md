# construction-crm

Мини-CRM «Объекты и задачи» для 2B Studio. Реализован этап 1: PostgreSQL/Supabase и безопасность. Frontend и деплой ещё не выполнялись.

## Локальная база

Нужны Node.js 22+, npm и работающий Docker. Supabase CLI закреплён в devDependencies.

```sh
npm ci
npm run db:start
npm run db:test
npm run db:test:concurrency
npm run db:test:api
npm run db:lint
```

`npm run db:reset` пересоздаёт **локальную** БД проекта и применяет миграции с нуля; локальные данные удаляются. `npm run db:stop` останавливает сервисы проекта.

Локальные адреса: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, PostgreSQL `127.0.0.1:54322`. Тест конкурентности по умолчанию использует стандартное локальное подключение Supabase; переопределение — переменная `TEST_DATABASE_URL` (только localhost).

Открытая и анонимная регистрации отключены. После ручного создания пользователя в Auth администратор добавляет профиль в SQL Editor:

```sql
insert into public.profiles (id, display_name, role)
values ('UUID_СОЗДАННОГО_AUTH_ПОЛЬЗОВАТЕЛЯ', 'Имя', 'manager');
-- Для исполнителя: role = 'executor'.
```

Пароли и ключи сюда не записываются. Миграции не создают учётные записи, а тестовые fixtures удаляются после проверок. Демо-аккаунты относятся к этапу 4.

Описание требований, таблиц, политик, RPC и допущений: [docs/database-security.md](docs/database-security.md).
Результаты текущего запуска: [docs/stage-1-report.md](docs/stage-1-report.md).

Официальные справочники: [локальный Supabase](https://supabase.com/docs/guides/local-development), [pgTAP](https://supabase.com/docs/guides/database/testing), [блокировки SELECT FOR UPDATE](https://www.postgresql.org/docs/17/sql-select.html).
