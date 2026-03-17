# Vouch — Claude Instructions

## Read Context First

Before working on any task in this repo, **read the context folder**:

```
context/context.md       — full codebase overview, data model, reputation system, lifecycle, gotchas
context/PRD.md           — product requirements (what the app must do and why)
context/SYSTEM_SPEC.md   — implementation contracts (DB schema, RLS, job behavior, edge cases)
```

For specific implementation details (field names, migration constraints, RLS policies), `SYSTEM_SPEC.md` is the authority.
For product intent and user journeys, `PRD.md` is the authority.
For a quick orientation on how things are wired together, start with `context.md`.

## After Significant Changes

After any feature addition, refactor, or schema change:
1. Update `context/context.md` to reflect the new state (tables, actions, components, etc.)
2. If the PRD or system spec changed, update the copies in `context/` as well

## Test Standards

Every new or modified test must include inline comments covering:
1. **What and why this test checks**
2. **Passing scenario**
3. **Failing scenario**

(Full detail in `AGENTS.md`)

## Key Rules

- Server actions in `src/actions/` are the write boundary — no business logic in route handlers
- All DB access uses Supabase clients from `src/lib/supabase/` — never raw SQL from client
- XState machine in `src/lib/xstate/task-machine.ts` is advisory — actual transitions happen in server actions
- Background jobs use the admin Supabase client (`createAdminClient`) only
- RLS is always on — test with user-scoped client, not admin, when checking access control
- `src/lib/types.ts` is the TypeScript source of truth for DB shapes (may lag behind migrations — check SYSTEM_SPEC.md when in doubt)
