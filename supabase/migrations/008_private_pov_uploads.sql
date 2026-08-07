-- Privé en egresszuinig inzenden van POV-foto's.
-- De client reserveert eerst één gecontroleerd pad. Alleen dat pad mag daarna
-- door dezelfde gebruiker in de private Storage-bucket worden gevuld.

create table if not exists public.pov_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id text not null,
  assignment_title text not null,
  class_code text not null,
  uploader_profile_id uuid not null references public.profiles(id),
  storage_path text not null unique,
  caption text,
  original_filename text,
  byte_size integer,
  mime_type text,
  status text not null default 'pending' check (status in ('pending', 'uploaded')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);

create index if not exists pov_submissions_organizer_index
  on public.pov_submissions (status, created_at desc);
create index if not exists pov_submissions_owner_index
  on public.pov_submissions (uploader_profile_id, assignment_id, status);

alter table public.pov_submissions enable row level security;
revoke all on public.pov_submissions from public, anon, authenticated;
grant select on public.pov_submissions to authenticated;

drop policy if exists "POV eigen inzendingen of organisatie lezen" on public.pov_submissions;
create policy "POV eigen inzendingen of organisatie lezen"
on public.pov_submissions for select to authenticated
using (
  uploader_profile_id in (
    select p.id from public.profiles p
    where p.auth_user_id = (select auth.uid()) and p.active = true
  )
  or exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.active = true
      and p.profile_type = 'organizer'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pov-inzendingen', 'pov-inzendingen', false, 1572864, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "POV gereserveerd bestand uploaden" on storage.objects;
create policy "POV gereserveerd bestand uploaden"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pov-inzendingen'
  and exists (
    select 1
    from public.pov_submissions s
    join public.profiles p on p.id = s.uploader_profile_id
    where s.storage_path = name
      and s.status = 'pending'
      and p.auth_user_id = (select auth.uid())
      and p.active = true
  )
);

drop policy if exists "POV eigen bestand of organisatie lezen" on storage.objects;
create policy "POV eigen bestand of organisatie lezen"
on storage.objects for select to authenticated
using (
  bucket_id = 'pov-inzendingen'
  and (
    exists (
      select 1
      from public.pov_submissions s
      join public.profiles p on p.id = s.uploader_profile_id
      where s.storage_path = name
        and s.status = 'uploaded'
        and p.auth_user_id = (select auth.uid())
        and p.active = true
    )
    or exists (
      select 1 from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and p.active = true
        and p.profile_type = 'organizer'
    )
  )
);

drop policy if exists "POV eigen tijdelijk bestand verwijderen" on storage.objects;
create policy "POV eigen tijdelijk bestand verwijderen"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pov-inzendingen'
  and exists (
    select 1
    from public.pov_submissions s
    join public.profiles p on p.id = s.uploader_profile_id
    where s.storage_path = name
      and p.auth_user_id = (select auth.uid())
      and p.active = true
  )
);

create or replace function public.prepare_pov_upload(requested_assignment_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_record record;
  assignment_record jsonb;
  max_uploads integer;
  deadline_at timestamptz;
  submission_id uuid := gen_random_uuid();
  safe_assignment_id text;
  reserved_path text;
  current_count integer;
begin
  select p.id, p.profile_type, c.code as class_code
  into profile_record
  from public.profiles p
  join public.class_memberships cm on cm.profile_id = p.id and cm.active = true
  join public.classes c on c.id = cm.class_id and c.active = true
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type in ('student', 'buddy')
  order by cm.updated_at desc
  limit 1;

  if profile_record.id is null then
    raise exception 'Alleen een actieve student of buddy met klas mag inzenden.' using errcode = '42501';
  end if;

  select assignment
  into assignment_record
  from public.app_content_snapshot snapshot,
       lateral jsonb_array_elements(coalesce(snapshot.content->'povAssignments', '[]'::jsonb)) assignment
  where snapshot.singleton_id = true
    and assignment->>'id' = requested_assignment_id
    and coalesce((assignment->>'active')::boolean, false) = true
    and (
      assignment->>'classCodes' = 'all'
      or (
        jsonb_typeof(assignment->'classCodes') = 'array'
        and assignment->'classCodes' ? profile_record.class_code
      )
    )
  limit 1;

  if assignment_record is null then
    raise exception 'Deze POV-opdracht is niet actief voor jouw klas.' using errcode = '22023';
  end if;

  max_uploads := greatest(1, least(10, coalesce((assignment_record->>'maxUploads')::integer, 5)));
  deadline_at := (assignment_record->>'deadlineAt')::timestamptz;
  if deadline_at < now() then
    raise exception 'De inzenddeadline van deze opdracht is verstreken.' using errcode = '22023';
  end if;

  select count(*) into current_count
  from public.pov_submissions s
  where s.uploader_profile_id = profile_record.id
    and s.assignment_id = requested_assignment_id
    and (s.status = 'uploaded' or s.created_at > now() - interval '30 minutes');

  if current_count >= max_uploads then
    raise exception 'Je hebt het maximumaantal foto''s voor deze opdracht bereikt.' using errcode = '22023';
  end if;

  safe_assignment_id := regexp_replace(lower(requested_assignment_id), '[^a-z0-9_-]+', '-', 'g');
  reserved_path := (select auth.uid())::text || '/' || lower(profile_record.class_code) || '/' || safe_assignment_id || '/' || submission_id::text || '.jpg';

  insert into public.pov_submissions (
    id, assignment_id, assignment_title, class_code, uploader_profile_id, storage_path
  ) values (
    submission_id,
    requested_assignment_id,
    assignment_record->>'title',
    profile_record.class_code,
    profile_record.id,
    reserved_path
  );

  return jsonb_build_object('id', submission_id, 'path', reserved_path, 'maxUploads', max_uploads);
end;
$$;

create or replace function public.complete_pov_upload(
  requested_submission_id uuid,
  submitted_caption text,
  submitted_original_filename text,
  submitted_byte_size integer,
  submitted_mime_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if submitted_byte_size < 1 or submitted_byte_size > 1572864 or submitted_mime_type <> 'image/jpeg' then
    raise exception 'Het geüploade bestand voldoet niet aan de foto-eisen.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.pov_submissions s
    join public.profiles p on p.id = s.uploader_profile_id
    join storage.objects o on o.bucket_id = 'pov-inzendingen' and o.name = s.storage_path
    where s.id = requested_submission_id
      and p.auth_user_id = (select auth.uid())
      and p.active = true
      and s.status = 'pending'
  ) then
    raise exception 'Het geuploade bestand is niet gevonden.' using errcode = '22023';
  end if;

  update public.pov_submissions s
  set caption = nullif(left(btrim(submitted_caption), 240), ''),
      original_filename = left(submitted_original_filename, 180),
      byte_size = submitted_byte_size,
      mime_type = submitted_mime_type,
      status = 'uploaded',
      uploaded_at = now()
  from public.profiles p
  where s.id = requested_submission_id
    and s.uploader_profile_id = p.id
    and p.auth_user_id = (select auth.uid())
    and p.active = true
    and s.status = 'pending';

  if not found then
    raise exception 'Deze uploadreservering is niet geldig.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.cancel_pov_upload(requested_submission_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.pov_submissions s
  using public.profiles p
  where s.id = requested_submission_id
    and s.uploader_profile_id = p.id
    and p.auth_user_id = (select auth.uid())
    and p.active = true
    and s.status = 'pending';
$$;

create or replace function public.list_pov_submissions(
  requested_limit integer default 50,
  requested_offset integer default 0
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
  uploaded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.active = true
      and p.profile_type = 'organizer'
  ) then
    raise exception 'Alleen de organisatie mag alle POV-inzendingen bekijken.' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.assignment_id,
    s.assignment_title,
    s.class_code,
    concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name) as uploader_name,
    s.storage_path,
    s.caption,
    s.byte_size,
    s.uploaded_at
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
  order by s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 100))
  offset greatest(coalesce(requested_offset, 0), 0);
end;
$$;

revoke all on function public.prepare_pov_upload(text) from public, anon;
revoke all on function public.complete_pov_upload(uuid, text, text, integer, text) from public, anon;
revoke all on function public.cancel_pov_upload(uuid) from public, anon;
revoke all on function public.list_pov_submissions(integer, integer) from public, anon;
grant execute on function public.prepare_pov_upload(text) to authenticated;
grant execute on function public.complete_pov_upload(uuid, text, text, integer, text) to authenticated;
grant execute on function public.cancel_pov_upload(uuid) to authenticated;
grant execute on function public.list_pov_submissions(integer, integer) to authenticated;

comment on table public.pov_submissions is
  'Metadata voor private, gecomprimeerde POV-inzendingen; foto-objecten staan in één Storage-bucket.';
