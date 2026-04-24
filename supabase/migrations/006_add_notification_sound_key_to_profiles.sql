alter table public.profiles
  add column if not exists notification_sound_key text not null default 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_notification_sound_key_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_notification_sound_key_check
      check (notification_sound_key in ('default', 'tone_01', 'tone_02', 'tone_03'));
  end if;
end
$$;
