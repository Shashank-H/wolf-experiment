# Database Migration Preflight

## Problem

`drizzle-kit migrate` can fail with only:

```txt
[⣷] applying migrations...error: script "db:migrate" exited with code 1
```

In the observed local environment, the real underlying error was:

```txt
PostgresError: password authentication failed for user "wolf"
```

That means `.env` points to `postgres://wolf:<password>@localhost:5432/wolf`, but the Postgres server listening on `5432` does not accept that password. Common causes:

- an old Docker Compose volume was initialized with a different password;
- another local Postgres server is using port `5432`;
- `.env` was changed after the Postgres volume was created.

## Fix

Added `backend/src/db/preflight.ts` and changed backend `db:migrate` to:

```json
"db:migrate": "bun src/db/preflight.ts && drizzle-kit migrate"
```

Now migration failures print actionable diagnostics before Drizzle runs.

## Local recovery options

If local database data is disposable:

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres redis
bun run db:migrate
```

If data is not disposable, update `DATABASE_URL` in `.env` to match the existing Postgres user/password/port instead of deleting the volume.

## Validation

Running `bun run db:migrate` now reports:

```txt
Database authentication failed.
Your DATABASE_URL user/password does not match the Postgres server on that port.
```

instead of the opaque Drizzle spinner-only failure.
