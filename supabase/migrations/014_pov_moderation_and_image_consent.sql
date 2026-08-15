-- POV-foto's blijven voor klasleden afgeschermd tot goedkeuring.
-- Alleen een actieve organisator kan foto's definitief verwijderen.
-- Beeldtoestemming wordt per profiel met een apart auditspoor vastgelegd.

drop policy if exists "POV eigen klas of organisatiebestand lezen" on storage.objects;
create policy "POV goedgekeurd klasbestand of organisatiebestand lezen"
on storage.objects for select to authenticated
using (
  bucket_id = 'pov-inzendingen'
  and (
    exists (
      select 1
      from public.pov_submissions s
      join public.profiles viewer on viewer.auth_user_id = (select auth.uid()) and viewer.active = true
      join public.class_memberships cm on cm.profile_id = viewer.id and cm.active = true
      join public.classes c on c.id = cm.class_id and c.active = true
      where s.storage_path = name
        and s.status = 'uploaded'
        and s.review_status = 'approved'
        and viewer.profile_type in ('student', 'buddy')
        and c.code = s.class_code
    )
    or exists (
      select 1 from public.profiles viewer
      where viewer.auth_user_id = (select auth.uid())
        and viewer.active = true
        and viewer.profile_type = 'organizer'
    )
  )
);

drop policy if exists "POV eigen tijdelijk bestand verwijderen" on storage.objects;
drop policy if exists "Alleen organisatie verwijdert POV-bestanden" on storage.objects;
create policy "Alleen organisatie verwijdert POV-bestanden"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pov-inzendingen'
  and exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type = 'organizer'
  )
);

create or replace function public.list_class_pov_submissions(
  requested_assignment_id text,
  requested_limit integer default 50
)
returns table (
  id uuid,
  assignment_id text,
  assignment_title text,
  class_code text,
  uploader_name text,
  storage_path text,
  caption text,
  byte_size integer,
  uploaded_at timestamptz,
  review_status text,
  rejection_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_class_code text;
begin
  select c.code into viewer_class_code
  from public.profiles viewer
  join public.class_memberships cm on cm.profile_id = viewer.id and cm.active = true
  join public.classes c on c.id = cm.class_id and c.active = true
  where viewer.auth_user_id = (select auth.uid())
    and viewer.active = true
    and viewer.profile_type in ('student', 'buddy')
  order by cm.updated_at desc
  limit 1;

  if viewer_class_code is null then
    raise exception 'Alleen een actieve student of buddy met klas mag de klasgalerij bekijken.' using errcode = '42501';
  end if;

  return query
  select s.id, s.assignment_id, s.assignment_title, s.class_code,
    concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name),
    case when s.review_status = 'approved' then s.storage_path else '' end,
    s.caption, s.byte_size, s.uploaded_at, s.review_status, s.rejection_reason
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
    and s.class_code = viewer_class_code
    and s.assignment_id = requested_assignment_id
  order by case s.review_status when 'approved' then 0 when 'pending' then 1 else 2 end,
    s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 50));
end;
$$;

create or replace function public.delete_pov_submission(requested_submission_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_path text;
begin
  if not exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type = 'organizer'
  ) then
    raise exception 'Alleen de organisatie mag POV-inzendingen verwijderen.' using errcode = '42501';
  end if;

  delete from public.pov_submissions
  where id = requested_submission_id
  returning storage_path into deleted_path;

  if deleted_path is null then
    raise exception 'Deze POV-inzending is niet gevonden.' using errcode = '22023';
  end if;
  return deleted_path;
end;
$$;

create table if not exists public.image_consents (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  consent boolean not null,
  consent_version text not null,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.image_consent_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  consent boolean not null,
  consent_version text not null,
  recorded_at timestamptz not null default now()
);

alter table public.image_consents enable row level security;
alter table public.image_consent_events enable row level security;

revoke all on public.image_consents from anon, authenticated;
revoke all on public.image_consent_events from anon, authenticated;

create or replace function public.get_my_image_consent()
returns table (consent boolean, consent_version text, decided_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select c.consent, c.consent_version, c.decided_at, c.updated_at
  from public.image_consents c
  join public.profiles p on p.id = c.profile_id
  where p.auth_user_id = (select auth.uid()) and p.active = true
  limit 1;
$$;

create or replace function public.set_my_image_consent(requested_consent boolean, requested_version text)
returns table (consent boolean, consent_version text, decided_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_profile_id uuid;
  safe_version text := left(btrim(coalesce(requested_version, '')), 80);
begin
  select p.id into viewer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.active = true
  limit 1;

  if viewer_profile_id is null then
    raise exception 'Er is geen actief profiel aan deze gebruiker gekoppeld.' using errcode = '42501';
  end if;
  if safe_version = '' then
    raise exception 'De toestemmingsversie ontbreekt.' using errcode = '22023';
  end if;

  insert into public.image_consents (profile_id, consent, consent_version)
  values (viewer_profile_id, requested_consent, safe_version)
  on conflict (profile_id) do update
    set consent = excluded.consent,
        consent_version = excluded.consent_version,
        decided_at = now(),
        updated_at = now();

  insert into public.image_consent_events (profile_id, consent, consent_version)
  values (viewer_profile_id, requested_consent, safe_version);

  return query
  select c.consent, c.consent_version, c.decided_at, c.updated_at
  from public.image_consents c where c.profile_id = viewer_profile_id;
end;
$$;

revoke all on function public.list_class_pov_submissions(text, integer) from public, anon;
revoke all on function public.delete_pov_submission(uuid) from public, anon;
revoke all on function public.get_my_image_consent() from public, anon;
revoke all on function public.set_my_image_consent(boolean, text) from public, anon;
grant execute on function public.list_class_pov_submissions(text, integer) to authenticated;
grant execute on function public.delete_pov_submission(uuid) to authenticated;
grant execute on function public.get_my_image_consent() to authenticated;
grant execute on function public.set_my_image_consent(boolean, text) to authenticated;

comment on function public.delete_pov_submission(uuid) is 'Verwijdert POV-metadata uitsluitend voor een actieve organisator en levert het afgeschermde opslagpad voor objectverwijdering.';
comment on table public.image_consents is 'Actuele vrijwillige keuze per profiel voor herkenbaar beeldgebruik.';
comment on table public.image_consent_events is 'Onwijzigbaar auditspoor van wijzigingen in beeldtoestemming.';
