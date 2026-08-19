-- Sla toegekende POV-punten atomisch op en maak de echte klassestand compact leesbaar.

alter table public.pov_submissions
  add column if not exists awarded_points integer not null default 0,
  add column if not exists points_awarded_at timestamptz,
  add column if not exists points_awarded_by uuid references public.profiles(id);

alter table public.pov_submissions
  drop constraint if exists pov_submissions_awarded_points_check;
alter table public.pov_submissions
  add constraint pov_submissions_awarded_points_check
  check (awarded_points between 0 and 10000);

create table if not exists public.competition_score_events (
  id uuid primary key default gen_random_uuid(),
  class_code text not null references public.classes(code),
  pov_submission_id uuid unique references public.pov_submissions(id) on delete cascade,
  title text not null,
  category text not null default 'POV-foto',
  points integer not null check (points between 0 and 10000),
  awarded_at timestamptz not null default now(),
  awarded_by uuid references public.profiles(id)
);

create index if not exists competition_score_events_class_awarded_index
  on public.competition_score_events (class_code, awarded_at desc);

create table if not exists public.competition_score_state (
  singleton_id boolean primary key default true check (singleton_id),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.competition_score_state (singleton_id)
values (true)
on conflict (singleton_id) do nothing;

alter table public.competition_score_events enable row level security;
alter table public.competition_score_state enable row level security;
revoke all on public.competition_score_events from anon, authenticated;
revoke all on public.competition_score_state from anon, authenticated;

drop function if exists public.list_class_pov_submissions(text, integer);
create function public.list_class_pov_submissions(
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
  rejection_reason text,
  awarded_points integer
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
    s.caption, s.byte_size, s.uploaded_at, s.review_status, s.rejection_reason,
    case when s.review_status = 'approved' then s.awarded_points else 0 end
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
  awarded_points integer
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
  select s.id, s.assignment_id, s.assignment_title, s.class_code,
    concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name),
    s.storage_path, s.caption, s.byte_size, s.uploaded_at,
    s.review_status, s.rejection_reason, s.awarded_points
  from public.pov_submissions s
  join public.profiles p on p.id = s.uploader_profile_id
  where s.status = 'uploaded'
  order by s.uploaded_at desc, s.id desc
  limit greatest(1, least(coalesce(requested_limit, 50), 100))
  offset greatest(coalesce(requested_offset, 0), 0);
end;
$$;

create or replace function public.review_pov_submission_with_points(
  requested_submission_id uuid,
  requested_points integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
  submission_record record;
  previous_points integer;
  next_version bigint;
begin
  if requested_points is null or requested_points < 0 or requested_points > 10000 then
    raise exception 'Kies een puntenaantal tussen 0 en 10000.' using errcode = '22023';
  end if;

  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen de organisatie mag POV-punten toekennen.' using errcode = '42501';
  end if;

  select s.id, s.class_code, s.assignment_title, s.review_status, s.awarded_points
  into submission_record
  from public.pov_submissions s
  where s.id = requested_submission_id and s.status = 'uploaded'
  for update;

  if submission_record.id is null then
    raise exception 'Deze POV-inzending is niet gevonden.' using errcode = '22023';
  end if;

  select e.points into previous_points
  from public.competition_score_events e
  where e.pov_submission_id = requested_submission_id;

  insert into public.competition_score_events (
    class_code, pov_submission_id, title, category, points, awarded_at, awarded_by
  ) values (
    submission_record.class_code, requested_submission_id, submission_record.assignment_title,
    'POV-foto', requested_points, now(), organizer_profile_id
  )
  on conflict (pov_submission_id) do update
    set class_code = excluded.class_code,
        title = excluded.title,
        points = excluded.points,
        awarded_at = case
          when public.competition_score_events.points is distinct from excluded.points then now()
          else public.competition_score_events.awarded_at
        end,
        awarded_by = excluded.awarded_by;

  update public.pov_submissions
  set review_status = 'approved',
      rejection_reason = null,
      reviewed_at = now(),
      reviewed_by = organizer_profile_id,
      awarded_points = requested_points,
      points_awarded_at = case
        when review_status <> 'approved' or awarded_points is distinct from requested_points then now()
        else points_awarded_at
      end,
      points_awarded_by = organizer_profile_id
  where id = requested_submission_id;

  if submission_record.review_status <> 'approved'
     or coalesce(previous_points, -1) is distinct from requested_points then
    update public.competition_score_state
    set version = version + 1, updated_at = now()
    where singleton_id = true
    returning version into next_version;
  else
    select version into next_version from public.competition_score_state where singleton_id = true;
  end if;

  return jsonb_build_object(
    'submissionId', requested_submission_id,
    'classCode', submission_record.class_code,
    'awardedPoints', requested_points,
    'scoreVersion', next_version
  );
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
  had_score boolean := false;
begin
  if requested_review_status not in ('approved', 'rejected') then
    raise exception 'Kies goedgekeurd of afgekeurd.' using errcode = '22023';
  end if;
  if requested_review_status = 'approved' then
    raise exception 'Gebruik bij goedkeuren altijd een puntenaantal.' using errcode = '22023';
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

  delete from public.competition_score_events
  where pov_submission_id = requested_submission_id;
  had_score := found;

  update public.pov_submissions
  set review_status = 'rejected',
      rejection_reason = nullif(left(btrim(coalesce(requested_rejection_reason, '')), 240), ''),
      reviewed_at = now(), reviewed_by = organizer_profile_id,
      awarded_points = 0, points_awarded_at = null, points_awarded_by = null
  where id = requested_submission_id and status = 'uploaded';
  if not found then
    raise exception 'Deze POV-inzending is niet gevonden.' using errcode = '22023';
  end if;

  if had_score then
    update public.competition_score_state
    set version = version + 1, updated_at = now()
    where singleton_id = true;
  end if;
end;
$$;

create or replace function public.get_competition_score_version()
returns bigint
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid()) and viewer.active = true
  ) then
    raise exception 'Geen actief profiel.' using errcode = '42501';
  end if;
  return (select version from public.competition_score_state where singleton_id = true);
end;
$$;

create or replace function public.list_competition_scores()
returns table (class_code text, total_points bigint, history jsonb)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.profiles viewer
    where viewer.auth_user_id = (select auth.uid()) and viewer.active = true
  ) then
    raise exception 'Geen actief profiel.' using errcode = '42501';
  end if;

  return query
  select c.code,
    coalesce(sum(e.points), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'points', e.points,
          'category', e.category,
          'awardedAt', e.awarded_at
        ) order by e.awarded_at desc
      ) filter (where e.id is not null),
      '[]'::jsonb
    )
  from public.classes c
  left join public.competition_score_events e on e.class_code = c.code
  where c.active = true
  group by c.code
  order by c.code;
end;
$$;

revoke all on function public.list_class_pov_submissions(text, integer) from public, anon;
revoke all on function public.list_pov_submissions_v2(integer, integer) from public, anon;
revoke all on function public.review_pov_submission_with_points(uuid, integer) from public, anon;
revoke all on function public.review_pov_submission(uuid, text, text) from public, anon;
revoke all on function public.get_competition_score_version() from public, anon;
revoke all on function public.list_competition_scores() from public, anon;
grant execute on function public.list_class_pov_submissions(text, integer) to authenticated;
grant execute on function public.list_pov_submissions_v2(integer, integer) to authenticated;
grant execute on function public.review_pov_submission_with_points(uuid, integer) to authenticated;
grant execute on function public.review_pov_submission(uuid, text, text) to authenticated;
grant execute on function public.get_competition_score_version() to authenticated;
grant execute on function public.list_competition_scores() to authenticated;

comment on table public.competition_score_events is 'Persistente, idempotente puntenmutaties voor het live klassement.';
comment on function public.review_pov_submission_with_points(uuid, integer) is 'Keurt een POV-foto goed en verwerkt het puntenaantal atomisch en zonder dubbeltelling.';
