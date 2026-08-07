revoke execute on function public.finalize_task_proof_atomic(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  integer,
  integer,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.finalize_task_proof_atomic(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  integer,
  integer,
  text,
  text
) to service_role;
