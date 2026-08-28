
npx trigger.dev@latest deploy

## Lifebench task export

Create the user's integration API key from the API section in Settings. The
plaintext key is shown only when it is created or rotated.

The read-only endpoint is:

```text
curl -H "Authorization: Bearer vouch_..." \
  "/api/integrations/lifebench/tasks?from=2026-08-01T00:00:00%2B02:00&to=2026-09-01T00:00:00%2B02:00"
```

`from` is inclusive, `to` is exclusive, and both must be ISO 8601 timestamps
with a timezone. The endpoint filters on `deadline`, accepts ranges up to 366
days, and returns raw task data without aggregating it. It currently requires
the user's integration API key in the `Authorization` header.
