-- Introweek-app: veilige basis voor profielen, klassen en koppelingen.
-- Deze migratie bevat bewust nog geen programma-, score- of notificatiedata.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  create type public.profile_type as enum ('student', 'buddy', 'poer', 'organizer');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.membership_role as enum ('student', 'buddy', 'poer');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  student_number text unique,
  first_name text not null,
  name_prefix text,
  last_name text not null,
  profile_type public.profile_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_normalized check (email = lower(btrim(email))),
  constraint profiles_student_number_by_role check (
    (profile_type in ('student', 'buddy') and student_number is not null)
    or profile_type in ('poer', 'organizer')
  )
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  country text not null,
  flag text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  membership_role public.membership_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, class_id, membership_role)
);

create index if not exists class_memberships_profile_id_idx
  on public.class_memberships(profile_id);
create index if not exists class_memberships_class_id_idx
  on public.class_memberships(class_id);

insert into public.classes (code, country, flag)
values
  ('LM1A', 'Australië', '🇦🇺'),
  ('LM1B', 'Brazilië', '🇧🇷'),
  ('LM1C', 'Canada', '🇨🇦'),
  ('LM1D', 'Denemarken', '🇩🇰'),
  ('LM1E', 'Estland', '🇪🇪'),
  ('LM1F', 'Frankrijk', '🇫🇷'),
  ('LM1G', 'Griekenland', '🇬🇷'),
  ('LM1H', 'Hongarije', '🇭🇺')
on conflict (code) do update
set country = excluded.country,
    flag = excluded.flag,
    active = true,
    updated_at = now();

-- Koppel een nieuwe Supabase-gebruiker alleen aan een vooraf geïmporteerd,
-- actief profiel met exact hetzelfde genormaliseerde e-mailadres.
create or replace function private.link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    update public.profiles
    set auth_user_id = new.id,
        updated_at = now()
    where email = lower(btrim(new.email))
      and active = true
      and (auth_user_id is null or auth_user_id = new.id);
  end if;

  return new;
end;
$$;

revoke all on function private.link_auth_user_to_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_link_profile on auth.users;
create trigger on_auth_user_link_profile
  after insert or update of email on auth.users
  for each row execute function private.link_auth_user_to_profile();

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_memberships enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.classes from anon, authenticated;
revoke all on table public.class_memberships from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.classes to authenticated;
grant select on table public.class_memberships to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = auth_user_id);

drop policy if exists "classes_select_authenticated" on public.classes;
create policy "classes_select_authenticated"
on public.classes
for select
to authenticated
using (true);

drop policy if exists "memberships_select_own" on public.class_memberships;
create policy "memberships_select_own"
on public.class_memberships
for select
to authenticated
using (
  profile_id in (
    select id
    from public.profiles
    where auth_user_id = (select auth.uid())
  )
);
