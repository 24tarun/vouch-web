create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.user_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  account_tier text not null default 'free'
    check (account_tier in ('free', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_voucher_usage (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'reserved'
    check (state in ('reserved', 'consumed', 'released')),
  reserved_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'reserved' and reserved_at is not null and consumed_at is null and released_at is null)
    or (state = 'consumed' and consumed_at is not null and released_at is null)
    or (state = 'released' and consumed_at is null and released_at is not null)
  )
);

create index ai_voucher_usage_user_state_idx
  on public.ai_voucher_usage(user_id, state);
create index ai_voucher_usage_user_consumed_idx
  on public.ai_voucher_usage(user_id, consumed_at)
  where state = 'consumed';

alter table public.user_entitlements enable row level security;
alter table public.ai_voucher_usage enable row level security;

create policy "Users can view own entitlement"
  on public.user_entitlements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view own AI voucher usage"
  on public.ai_voucher_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.user_entitlements from public, anon, authenticated;
revoke all on table public.ai_voucher_usage from public, anon, authenticated;
grant select on table public.user_entitlements to authenticated;
grant select on table public.ai_voucher_usage to authenticated;
grant all on table public.user_entitlements to service_role;
grant all on table public.ai_voucher_usage to service_role;

insert into public.user_entitlements (user_id, account_tier)
select id, 'free'
from public.profiles
on conflict (user_id) do nothing;

insert into public.ai_voucher_usage (
  task_id,
  user_id,
  state,
  reserved_at,
  consumed_at,
  created_at,
  updated_at
)
select
  av.task_id,
  t.user_id,
  'consumed',
  min(av.vouched_at),
  min(av.vouched_at),
  min(av.vouched_at),
  now()
from public.ai_vouches av
join public.tasks t on t.id = av.task_id
group by av.task_id, t.user_id
on conflict (task_id) do nothing;

create or replace function private.create_default_user_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_entitlements (user_id, account_tier)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_default_user_entitlement() from public, anon, authenticated;

create trigger profiles_create_default_entitlement
after insert on public.profiles
for each row execute function private.create_default_user_entitlement();

create or replace function public.get_ai_voucher_quota()
returns table (
  account_tier text,
  used integer,
  pending integer,
  monthly_limit integer,
  remaining integer,
  resets_at timestamptz,
  can_start_review boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_tier text;
  v_used integer;
  v_pending integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(p.timezone, 'UTC'), coalesce(ue.account_tier, 'free')
    into v_timezone, v_tier
  from public.profiles p
  left join public.user_entitlements ue on ue.user_id = p.id
  where p.id = v_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  v_month_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;
  v_month_end := (date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone;

  select count(*)::integer
    into v_used
  from public.ai_voucher_usage
  where user_id = v_user_id
    and state = 'consumed'
    and consumed_at >= v_month_start
    and consumed_at < v_month_end;

  select count(*)::integer
    into v_pending
  from public.ai_voucher_usage
  where user_id = v_user_id
    and state = 'reserved';

  account_tier := v_tier;
  used := v_used;
  pending := v_pending;
  monthly_limit := case when v_tier = 'paid' then null else 5 end;
  remaining := case when v_tier = 'paid' then null else greatest(0, 5 - v_used - v_pending) end;
  resets_at := v_month_end;
  can_start_review := v_tier = 'paid' or (v_used + v_pending) < 5;
  return next;
end;
$$;

revoke all on function public.get_ai_voucher_quota() from public, anon;
grant execute on function public.get_ai_voucher_quota() to authenticated, service_role;

create or replace function public.reserve_ai_voucher_credit(
  p_user_id uuid,
  p_task_id uuid
)
returns table (
  allowed boolean,
  error_code text,
  account_tier text,
  used integer,
  pending integer,
  monthly_limit integer,
  remaining integer,
  resets_at timestamptz,
  reservation_created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ai_profile_id constant uuid := '11111111-1111-1111-1111-111111111111';
  v_timezone text;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_tier text;
  v_used integer;
  v_pending integer;
  v_existing_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':ai-voucher-credit', 0));

  if not exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.user_id = p_user_id
      and t.voucher_id = v_ai_profile_id
  ) then
    raise exception 'Task is not an AI-vouched task owned by this user';
  end if;

  select coalesce(p.timezone, 'UTC'), coalesce(ue.account_tier, 'free')
    into v_timezone, v_tier
  from public.profiles p
  left join public.user_entitlements ue on ue.user_id = p.id
  where p.id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  v_month_start := date_trunc('month', now() at time zone v_timezone) at time zone v_timezone;
  v_month_end := (date_trunc('month', now() at time zone v_timezone) + interval '1 month') at time zone v_timezone;

  select state
    into v_existing_state
  from public.ai_voucher_usage
  where task_id = p_task_id
  for update;

  select count(*)::integer
    into v_used
  from public.ai_voucher_usage
  where user_id = p_user_id
    and state = 'consumed'
    and consumed_at >= v_month_start
    and consumed_at < v_month_end;

  select count(*)::integer
    into v_pending
  from public.ai_voucher_usage
  where user_id = p_user_id
    and state = 'reserved';

  if v_existing_state in ('consumed', 'reserved') then
    allowed := true;
    error_code := null;
    account_tier := v_tier;
    used := v_used;
    pending := v_pending;
    monthly_limit := case when v_tier = 'paid' then null else 5 end;
    remaining := case when v_tier = 'paid' then null else greatest(0, 5 - v_used - v_pending) end;
    resets_at := v_month_end;
    reservation_created := false;
    return next;
    return;
  end if;

  if v_tier = 'free' and (v_used + v_pending) >= 5 then
    allowed := false;
    error_code := 'AI_QUOTA_EXHAUSTED';
    account_tier := v_tier;
    used := v_used;
    pending := v_pending;
    monthly_limit := 5;
    remaining := 0;
    resets_at := v_month_end;
    reservation_created := false;
    return next;
    return;
  end if;

  insert into public.ai_voucher_usage (
    task_id,
    user_id,
    state,
    reserved_at,
    consumed_at,
    released_at,
    updated_at
  )
  values (p_task_id, p_user_id, 'reserved', now(), null, null, now())
  on conflict (task_id) do update
    set user_id = excluded.user_id,
        state = 'reserved',
        reserved_at = excluded.reserved_at,
        consumed_at = null,
        released_at = null,
        updated_at = now();

  allowed := true;
  error_code := null;
  account_tier := v_tier;
  used := v_used;
  pending := v_pending + 1;
  monthly_limit := case when v_tier = 'paid' then null else 5 end;
  remaining := case when v_tier = 'paid' then null else greatest(0, 5 - v_used - v_pending - 1) end;
  resets_at := v_month_end;
  reservation_created := true;
  return next;
end;
$$;

revoke all on function public.reserve_ai_voucher_credit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_voucher_credit(uuid, uuid) to service_role;

create or replace function public.release_ai_voucher_credit(
  p_user_id uuid,
  p_task_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_released boolean;
begin
  update public.ai_voucher_usage
  set state = 'released',
      reserved_at = null,
      released_at = now(),
      updated_at = now()
  where task_id = p_task_id
    and user_id = p_user_id
    and state = 'reserved';

  v_released := found;
  return v_released;
end;
$$;

revoke all on function public.release_ai_voucher_credit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_ai_voucher_credit(uuid, uuid) to service_role;

create or replace function public.rollback_ai_voucher_submission(
  p_user_id uuid,
  p_task_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_previous_status text;
  v_has_prior_review boolean;
begin
  select exists (select 1 from public.ai_vouches where task_id = p_task_id)
    into v_has_prior_review;

  select case
      when v_has_prior_review then 'AWAITING_USER'
      when postponed_at is null then 'ACTIVE'
      else 'POSTPONED'
    end
    into v_previous_status
  from public.tasks
  where id = p_task_id
    and user_id = p_user_id
    and status = 'AWAITING_AI'
  for update;

  if not found then
    return false;
  end if;

  update public.tasks
  set status = v_previous_status,
      marked_completed_at = case when v_has_prior_review then marked_completed_at else null end,
      updated_at = now()
  where id = p_task_id
    and user_id = p_user_id
    and status = 'AWAITING_AI';

  if not v_has_prior_review then
    insert into public.task_events (
      task_id,
      event_type,
      actor_id,
      from_status,
      to_status,
      metadata
    ) values (
      p_task_id,
      'UNDO_COMPLETE',
      p_user_id,
      'AWAITING_AI',
      v_previous_status,
      jsonb_build_object('reason', p_reason)
    );
  end if;

  return true;
end;
$$;

revoke all on function public.rollback_ai_voucher_submission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rollback_ai_voucher_submission(uuid, uuid, text) to service_role;

create or replace function private.reserve_ai_credit_before_vouch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_result record;
begin
  select user_id into v_user_id
  from public.tasks
  where id = new.task_id;

  if v_user_id is null then
    raise exception 'Task not found for AI voucher result';
  end if;

  select * into v_result
  from public.reserve_ai_voucher_credit(v_user_id, new.task_id);

  if not coalesce(v_result.allowed, false) then
    raise exception 'AI_QUOTA_EXHAUSTED';
  end if;

  return new;
end;
$$;

revoke all on function private.reserve_ai_credit_before_vouch() from public, anon, authenticated;

create trigger ai_vouches_reserve_credit
before insert on public.ai_vouches
for each row execute function private.reserve_ai_credit_before_vouch();

create or replace function private.consume_ai_credit_after_vouch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ai_voucher_usage
  set state = 'consumed',
      consumed_at = coalesce(consumed_at, new.vouched_at),
      released_at = null,
      updated_at = now()
  where task_id = new.task_id;
  return new;
end;
$$;

revoke all on function private.consume_ai_credit_after_vouch() from public, anon, authenticated;

create trigger ai_vouches_consume_credit
after insert on public.ai_vouches
for each row execute function private.consume_ai_credit_after_vouch();

create or replace function private.release_ai_credit_after_task_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'AWAITING_AI' and new.status in ('ACTIVE', 'POSTPONED', 'DELETED') then
    update public.ai_voucher_usage
    set state = 'released',
        reserved_at = null,
        released_at = now(),
        updated_at = now()
    where task_id = new.id
      and state = 'reserved';
  end if;
  return new;
end;
$$;

revoke all on function private.release_ai_credit_after_task_cancel() from public, anon, authenticated;

create trigger tasks_release_pending_ai_credit
after update of status on public.tasks
for each row execute function private.release_ai_credit_after_task_cancel();
