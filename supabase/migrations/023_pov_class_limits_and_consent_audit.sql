-- Maak de POV-limiet daadwerkelijk per klas en leg nieuwe toestemmingsbevestigingen vast.

alter table public.pov_submissions
  add column if not exists consent_confirmed boolean not null default false,
  add column if not exists consent_confirmed_at timestamptz,
  add column if not exists consent_version text;

comment on column public.pov_submissions.consent_confirmed is
  'True wanneer de inzender bij het voltooien expliciet toestemming voor herkenbare personen bevestigde; false bij oudere inzendingen zonder afzonderlijke registratie.';
comment on column public.pov_submissions.consent_confirmed_at is
  'Tijdstip waarop de toestemmingsbevestiging voor deze inzending is vastgelegd.';
comment on column public.pov_submissions.consent_version is
  'Versie van de aan de inzender getoonde toestemmingsverklaring.';

create index if not exists pov_submissions_active_class_assignment_idx
  on public.pov_submissions (class_code, assignment_id)
  where status = 'pending'
     or (status = 'uploaded' and coalesce(review_status, 'pending') <> 'rejected');

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

  -- Serialiseer reserveringen voor dezelfde klas en opdracht, zodat gelijktijdige
  -- uploads de gezamenlijke klaslimiet niet kunnen overschrijden.
  perform pg_advisory_xact_lock(hashtextextended(
    profile_record.class_code || ':' || requested_assignment_id,
    0
  ));

  select count(*) into current_count
  from public.pov_submissions s
  where s.class_code = profile_record.class_code
    and s.assignment_id = requested_assignment_id
    and (
      (s.status = 'uploaded' and coalesce(s.review_status, 'pending') <> 'rejected')
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

-- Nieuwe overload: de bestaande vijf-argumentvariant blijft tijdelijk bruikbaar
-- voor al geopende oudere appversies, maar kan geen bevestiging registreren.
create or replace function public.complete_pov_upload(
  requested_submission_id uuid,
  submitted_caption text,
  submitted_original_filename text,
  submitted_byte_size integer,
  submitted_mime_type text,
  submitted_consent_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if submitted_consent_confirmed is distinct from true then
    raise exception 'Bevestig eerst de toestemming van herkenbare personen op de foto.' using errcode = '22023';
  end if;
  if submitted_byte_size < 1 or submitted_byte_size > 3145728 or submitted_mime_type <> 'image/jpeg' then
    raise exception 'Het geüploade bestand voldoet niet aan de foto-eisen.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.pov_submissions s
    join public.profiles p on p.id = s.uploader_profile_id
    join storage.objects o on o.bucket_id = 'pov-inzendingen' and o.name = s.storage_path
    where s.id = requested_submission_id
      and p.auth_user_id = (select auth.uid())
      and p.active
      and s.status = 'pending'
  ) then
    raise exception 'Het geüploade bestand is niet gevonden.' using errcode = '22023';
  end if;

  update public.pov_submissions s
  set caption = nullif(left(btrim(submitted_caption), 240), ''),
      original_filename = left(submitted_original_filename, 180),
      byte_size = submitted_byte_size,
      mime_type = submitted_mime_type,
      status = 'uploaded',
      uploaded_at = now(),
      consent_confirmed = true,
      consent_confirmed_at = now(),
      consent_version = 'recognizable-persons-v1'
  from public.profiles p
  where s.id = requested_submission_id
    and s.uploader_profile_id = p.id
    and p.auth_user_id = (select auth.uid())
    and p.active
    and s.status = 'pending';

  if not found then
    raise exception 'Deze uploadreservering is niet geldig.' using errcode = '42501';
  end if;
end;
$$;

drop function if exists public.list_pov_submissions_v2(integer, integer);
create function public.list_pov_submissions_v2(
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
  rejection_reason text,
  awarded_points integer,
  consent_confirmed boolean,
  consent_confirmed_at timestamptz,
  consent_version text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.active = true
      and viewer.profile_type = 'organizer'
  ) then
    raise exception 'Alleen de organisatie mag alle POV-inzendingen bekijken.' using errcode = '42501';
  end if;

  return query
  select s.id, s.assignment_id, s.assignment_title, s.class_code,
    concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name),
    s.storage_path, s.caption, s.byte_size, s.uploaded_at,
    s.review_status, s.rejection_reason, s.awarded_points,
    s.consent_confirmed, s.consent_confirmed_at, s.consent_version
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
  order by s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 100))
  offset greatest(coalesce(requested_offset, 0), 0);
end;
$$;

revoke all on function public.prepare_pov_upload(text) from public, anon;
revoke all on function public.complete_pov_upload(uuid, text, text, integer, text, boolean) from public, anon;
revoke all on function public.list_pov_submissions_v2(integer, integer) from public, anon;

grant execute on function public.prepare_pov_upload(text) to authenticated;
grant execute on function public.complete_pov_upload(uuid, text, text, integer, text, boolean) to authenticated;
grant execute on function public.list_pov_submissions_v2(integer, integer) to authenticated;

comment on function public.prepare_pov_upload(text) is
  'Reserveert atomisch een private POV-upload binnen de gezamenlijke limiet van de klas; afgekeurde inzendingen tellen niet mee.';
comment on function public.complete_pov_upload(uuid, text, text, integer, text, boolean) is
  'Voltooit een private JPEG-upload en registreert de expliciete toestemmingsbevestiging van de inzender.';
comment on function public.list_pov_submissions_v2(integer, integer) is
  'Levert uitsluitend aan organisatoren compacte POV-metadata inclusief de geregistreerde toestemmingsbevestiging.';
