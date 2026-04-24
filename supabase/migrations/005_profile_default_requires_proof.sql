alter table public.profiles
add column if not exists default_requires_proof_for_all_tasks boolean not null default false;
