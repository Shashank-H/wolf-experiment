# Root Environment Loading Fix

## Problem

The intended setup is one root `.env`, but `npm run dev` starts commands inside `backend/` and `frontend/`. Tooling can then miss the root `.env`, or a copied placeholder `APP_ENCRYPTION_KEY` can break local startup.

## Fix

- `scripts/dev.mjs` now loads the root `.env` before spawning backend and frontend processes.
- Backend config now also loads `.env` from either the current working directory or the parent directory, so these both work:

```bash
npm run dev
bun run dev:backend
```

- Shell-provided variables still win over `.env` values.
- Production still requires a valid explicit `APP_ENCRYPTION_KEY`.
- Development/test tolerate a missing or placeholder/invalid encryption key by using a local-only fallback key.

## Recommended setup

Keep only one local env file at repo root:

```txt
.env
.env.example
backend/
frontend/
```

Frontend variables must be public and prefixed with `VITE_`. Backend secrets should not be exposed to frontend code.

## Validation

Validated:

```bash
bun run typecheck
timeout --signal=INT 6s npm run dev
```

The backend and frontend start, load root env, and exit cleanly on SIGINT.
