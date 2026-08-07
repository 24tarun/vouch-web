-- Keep the completion invariant enforced even when a client has stale subtask data.
create or replace function public.prevent_completion_with_incomplete_subtasks()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('ACTIVE', 'POSTPONED')
     and new.status in ('MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI', 'ACCEPTED')
     and exists (
       select 1
       from public.task_subtasks
       where parent_task_id = new.id
         and is_completed = false
     ) then
    raise exception 'All subtasks must be completed before marking this task complete.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_require_completed_subtasks_before_completion on public.tasks;

create trigger tasks_require_completed_subtasks_before_completion
before update of status on public.tasks
for each row
execute function public.prevent_completion_with_incomplete_subtasks();
