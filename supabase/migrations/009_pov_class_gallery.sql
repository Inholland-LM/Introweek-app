-- Beveiligde POV-klasgalerij met egresszuinige metadata en moderatiestatus.
-- Eén opdrachtlimiet geldt voor de hele klas. Afgekeurde inzendingen maken
-- opnieuw een plek vrij en de foto zelf wordt niet meer aan klasleden geleverd.

alter table public.pov_submissions
  add column if not exists review_status text not null default 'pending',
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id);

alter table public.pov_submissions
  drop constraint if exists pov_submissions_review_status_check;
alter table public.pov_submissions
  add constraint pov_submissions_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));

create index if not exists pov_submissions_class_gallery_index
  on public.pov_submissions (class_code, assignment_id, status, review_status, uploaded_at desc);

drop policy if exists "POV eigen inzendingen of organisatie lezen" on public.pov_submissions;
drop policy if exists "POV eigen klas of organisatie lezen" on public.pov_submissions;
create policy "POV eigen klas of organisatie lezen"
on public.pov_submissions for select to authenticated
using (
  exists (
    select 1
    from public.profiles viewer
    join public.class_memberships cm on cm.profile_id = viewer.id and cm.active = true
    join public.classes c on c.id = cm.class_id and c.active = true
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type in ('student', 'buddy')
      and c.code = pov_submissions.class_code
  )
  or exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type = 'organizer'
  )
);

drop policy if exists "POV eigen bestand of organisatie lezen" on storage.objects;
drop policy if exists "POV eigen klas of organisatiebestand lezen" on storage.objects;
create policy "POV eigen klas of organisatiebestand lezen"
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
        and s.review_status <> 'rejected'
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
  where s.class_code = profile_record.class_code
    and s.assignment_id = requested_assignment_id
    and (
      (s.status = 'uploaded' and s.review_status <> 'rejected')
      or (s.status = 'pending' and s.created_at > now() - interval '30 minutes')
    );

  if current_count >= max_uploads then
    raise exception 'Jouw klas heeft het maximumaantal foto''s voor deze opdracht bereikt.' using errcode = '22023';
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
  select c.code
  into viewer_class_code
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
  select
    s.id,
    s.assignment_id,
    s.assignment_title,
    s.class_code,
    concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name) as uploader_name,
    case when s.review_status = 'rejected' then '' else s.storage_path end,
    s.caption,
    s.byte_size,
    s.uploaded_at,
    s.review_status,
    s.rejection_reason
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
    and s.class_code = viewer_class_code
    and s.assignment_id = requested_assignment_id
  order by case when s.review_status = 'rejected' then 1 else 0 end, s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 50));
end;
$$;

create or replace function public.list_pov_submissions_v2(
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
  uploaded_at timestamptz,
  review_status text,
  rejection_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type = 'organizer'
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
    s.uploaded_at,
    s.review_status,
    s.rejection_reason
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
  order by s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 100))
  offset greatest(coalesce(requested_offset, 0), 0);
end;
$$;

create or replace function public.review_pov_submission(
  requested_submission_id uuid,
  requested_review_status text,
  requested_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
begin
  if requested_review_status not in ('approved', 'rejected') then
    raise exception 'Kies goedgekeurd of afgekeurd.' using errcode = '22023';
  end if;

  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen de organisatie mag POV-inzendingen beoordelen.' using errcode = '42501';
  end if;

  update public.pov_submissions
  set review_status = requested_review_status,
      rejection_reason = case
        when requested_review_status = 'rejected' then nullif(left(btrim(coalesce(requested_rejection_reason, '')), 240), '')
        else null
      end,
      reviewed_at = now(),
      reviewed_by = organizer_profile_id
  where id = requested_submission_id
    and status = 'uploaded';

  if not found then
    raise exception 'Deze POV-inzending is niet gevonden.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.list_class_pov_submissions(text, integer) from public, anon;
revoke all on function public.list_pov_submissions_v2(integer, integer) from public, anon;
revoke all on function public.review_pov_submission(uuid, text, text) from public, anon;
grant execute on function public.list_class_pov_submissions(text, integer) to authenticated;
grant execute on function public.list_pov_submissions_v2(integer, integer) to authenticated;
grant execute on function public.review_pov_submission(uuid, text, text) to authenticated;

comment on function public.list_class_pov_submissions(text, integer) is
  'Levert compacte POV-metadata voor de eigen klas en één opdracht; afgekeurde foto-objecten blijven afgeschermd.';
