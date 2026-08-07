-- Eén compacte, versiegestuurde inhoudssnapshot voor programma, locaties,
-- berichten en overige organisatie-inhoud. Deelnemers halen de volledige
-- inhoud alleen op wanneer het versienummer wijzigt.

create table if not exists public.app_content_snapshot (
  singleton_id boolean primary key default true check (singleton_id),
  version bigint not null default 0,
  content jsonb not null default '{}'::jsonb,
  content_hash text not null default md5('{}'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.app_content_snapshot enable row level security;
revoke all on public.app_content_snapshot from public, anon, authenticated;

insert into public.app_content_snapshot (singleton_id)
values (true)
on conflict (singleton_id) do nothing;

create or replace function public.get_app_content_version()
returns bigint
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result bigint;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid()) and p.active = true
  ) then
    raise exception 'Geen actief profiel gekoppeld.' using errcode = '42501';
  end if;

  select s.version into result
  from public.app_content_snapshot s
  where s.singleton_id = true;
  return coalesce(result, 0);
end;
$$;

create or replace function public.get_app_content()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid()) and p.active = true
  ) then
    raise exception 'Geen actief profiel gekoppeld.' using errcode = '42501';
  end if;

  select jsonb_build_object('version', s.version, 'content', s.content, 'updatedAt', s.updated_at)
  into result
  from public.app_content_snapshot s
  where s.singleton_id = true;
  return coalesce(result, jsonb_build_object('version', 0, 'content', '{}'::jsonb));
end;
$$;

create or replace function public.apply_master_import(
  import_rows jsonb,
  expected_people_state_version text,
  imported_content jsonb,
  expected_content_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
  people_result jsonb;
  current_version bigint;
  new_version bigint;
begin
  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag importeren.' using errcode = '42501';
  end if;

  if jsonb_typeof(imported_content) <> 'object' then
    raise exception 'De inhoudssnapshot is ongeldig.' using errcode = '22023';
  end if;

  select s.version into current_version
  from public.app_content_snapshot s
  where s.singleton_id = true
  for update;

  if current_version is distinct from expected_content_version then
    raise exception 'De app-inhoud is intussen gewijzigd.' using errcode = '40001';
  end if;

  -- Een fout in een van beide onderdelen draait de volledige RPC-transactie terug.
  people_result := public.apply_people_import(import_rows, expected_people_state_version);

  new_version := current_version + 1;
  update public.app_content_snapshot
  set version = new_version,
      content = imported_content,
      content_hash = md5(imported_content::text),
      updated_at = now(),
      updated_by = organizer_profile_id
  where singleton_id = true;

  return jsonb_build_object(
    'people', people_result,
    'contentVersion', new_version,
    'contentHash', md5(imported_content::text)
  );
end;
$$;

revoke all on function public.get_app_content_version() from public, anon;
revoke all on function public.get_app_content() from public, anon;
revoke all on function public.apply_master_import(jsonb, text, jsonb, bigint) from public, anon;
grant execute on function public.get_app_content_version() to authenticated;
grant execute on function public.get_app_content() to authenticated;
grant execute on function public.apply_master_import(jsonb, text, jsonb, bigint) to authenticated;

comment on table public.app_content_snapshot is
  'Compacte actieve inhoudssnapshot; clients controleren eerst alleen het versienummer.';
comment on function public.apply_master_import(jsonb, text, jsonb, bigint) is
  'Verwerkt personen en organisatie-inhoud atomair na dubbele versiecontrole.';
