# Registration Error Sanitization

## Problem

Duplicate or database-level registration failures could surface Drizzle/Postgres internals to the client, including a full failed SQL query and parameters such as the generated password hash.

Example leaked response content:

```txt
Failed query: insert into "users" ...
params: admin@local.com,$argon2id$...
```

## Fix

- Added `backend/src/utils/db-errors.ts` with helpers for database error code/constraint inspection.
- Updated `POST /auth/register` to return safe responses:
  - duplicate email: `409` with `An account with this email already exists. Please log in instead.`
  - missing migration/table: `503` with migration guidance
  - other registration failures: sanitized `Registration failed`
- Updated global Elysia error handling to avoid returning raw `Failed query` messages.

## Validation

Validated with a fresh Postgres instance:

```txt
first registration: 201
second registration with same email: 409
```

Duplicate registration response:

```json
{"error":"An account with this email already exists. Please log in instead."}
```

The response no longer contains `Failed query`, SQL, or Argon2 password-hash data.
