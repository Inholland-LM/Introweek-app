-- Beheer de vier landenstrijd-rondes en de handmatig geregisseerde BLEND-finale.

alter table public.competition_score_events add column if not exists round_code text;
alter table public.competition_score_events drop constraint if exists competition_score_events_round_code_check;
alter table public.competition_score_events add constraint competition_score_events_round_code_check
  check (round_code is null or round_code in ('hag', 'sx', 'city_game', 'pov_final'));
create unique index if not exists competition_score_events_class_round_unique
  on public.competition_score_events (class_code, round_code) where round_code is not null;

create table if not exists public.competition_round_scores (
  class_code text not null references public.classes(code),
  round_code text not null check (round_code in ('hag', 'sx', 'city_game', 'pov_final')),
  points integer not null check (points between 0 and 10000),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (class_code, round_code)
);

create table if not exists public.competition_finale_state (
  singleton_id boolean primary key default true check (singleton_id),
  phase text not null default 'preparation' check (phase in ('preparation', 'ready', 'revealing', 'final')),
  reveal_order jsonb not null default '[]'::jsonb,
  next_index integer not null default 0,
  last_revealed_class_code text references public.classes(code),
  last_revealed_points integer,
  reveal_sequence bigint not null default 0,
  revealed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.competition_finale_state (singleton_id) values (true) on conflict do nothing;

alter table public.competition_round_scores enable row level security;
alter table public.competition_finale_state enable row level security;
revoke all on public.competition_round_scores from public, anon, authenticated;
revoke all on public.competition_finale_state from public, anon, authenticated;

create or replace function public.organizer_profile_id()
returns uuid language sql security definer set search_path = '' stable as $$
  select p.id from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.active and p.profile_type = 'organizer'
  limit 1
$$;

create or replace function public.list_competition_round_scores()
returns table (class_code text, round_code text, points integer, published boolean)
language plpgsql security definer set search_path = '' stable as $$
begin
  if public.organizer_profile_id() is null then raise exception 'Alleen de organisatie mag conceptscores bekijken.' using errcode = '42501'; end if;
  return query select s.class_code, s.round_code, s.points, s.published_at is not null from public.competition_round_scores s;
end $$;

create or replace function public.save_competition_round_scores(requested_round_code text, requested_scores jsonb, requested_publish boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare organizer_id uuid := public.organizer_profile_id(); item jsonb; changed boolean := false; next_version bigint;
begin
  if organizer_id is null then raise exception 'Alleen de organisatie mag punten beheren.' using errcode = '42501'; end if;
  if requested_round_code not in ('hag', 'sx', 'city_game', 'pov_final') then raise exception 'Onbekende scoreronde.' using errcode = '22023'; end if;
  if jsonb_typeof(requested_scores) <> 'array' then raise exception 'Scores moeten als lijst worden aangeleverd.' using errcode = '22023'; end if;
  if requested_publish and (
    jsonb_array_length(requested_scores) <> (select count(*) from public.classes where active)
    or (select count(distinct value->>'classCode') from jsonb_array_elements(requested_scores)) <> (select count(*) from public.classes where active)
  ) then raise exception 'Publiceren kan pas wanneer iedere actieve klas exact één score heeft.' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(requested_scores) loop
    if not exists (select 1 from public.classes c where c.code = item->>'classCode' and c.active) then raise exception 'Onbekende of inactieve klas.' using errcode = '22023'; end if;
    if (item->>'points')::integer not between 0 and 10000 then raise exception 'Punten moeten tussen 0 en 10.000 liggen.' using errcode = '22023'; end if;
    insert into public.competition_round_scores (class_code, round_code, points, published_at, updated_by)
    values (item->>'classCode', requested_round_code, (item->>'points')::integer, case when requested_publish and requested_round_code <> 'pov_final' then now() end, organizer_id)
    on conflict (class_code, round_code) do update set points = excluded.points,
      published_at = case when requested_publish and requested_round_code <> 'pov_final' then now() else public.competition_round_scores.published_at end,
      updated_at = now(), updated_by = organizer_id;
    if requested_publish and requested_round_code <> 'pov_final' then
      insert into public.competition_score_events (class_code, title, category, points, awarded_by, round_code)
      values (item->>'classCode', case requested_round_code when 'hag' then 'HAG' when 'sx' then 'SX' else 'City Game · CX, FRH & ENTR' end,
        case requested_round_code when 'city_game' then 'City Game' else 'Experience' end, (item->>'points')::integer, organizer_id, requested_round_code)
      on conflict (class_code, round_code) where round_code is not null do update set points=excluded.points, awarded_at=now(), awarded_by=organizer_id;
      changed := true;
    end if;
  end loop;
  if changed then update public.competition_score_state set version=version+1, updated_at=now() where singleton_id returning version into next_version;
  else select version into next_version from public.competition_score_state where singleton_id; end if;
  return next_version;
end $$;

create or replace function public.lock_competition_finale_order(requested_order jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare organizer_id uuid := public.organizer_profile_id(); active_count integer;
begin
  if organizer_id is null then raise exception 'Alleen de organisatie mag de finale voorbereiden.' using errcode='42501'; end if;
  select count(*) into active_count from public.classes where active;
  if jsonb_typeof(requested_order) <> 'array' or jsonb_array_length(requested_order) <> active_count
    or (select count(distinct value #>> '{}') from jsonb_array_elements(requested_order)) <> active_count
    or exists (select 1 from jsonb_array_elements_text(requested_order) o where not exists (select 1 from public.classes c where c.code=o.value and c.active))
  then raise exception 'De onthullingsvolgorde moet iedere actieve klas exact één keer bevatten.' using errcode='22023'; end if;
  if (select count(*) from public.competition_round_scores s join public.classes c on c.code=s.class_code and c.active where s.round_code='pov_final') <> active_count then
    raise exception 'Vul eerst voor iedere klas de POV-eindscore in.' using errcode='22023'; end if;
  if (select count(*) from public.competition_round_scores s join public.classes c on c.code=s.class_code and c.active where s.round_code='city_game' and s.published_at is not null) <> active_count then
    raise exception 'Publiceer eerst de City Game-score voor iedere klas.' using errcode='22023'; end if;
  update public.competition_finale_state set phase='ready', reveal_order=requested_order, next_index=0,
    last_revealed_class_code=null, last_revealed_points=null, revealed_at=null, updated_at=now(), updated_by=organizer_id where singleton_id;
end $$;

create or replace function public.reveal_next_competition_finalist(requested_class_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare organizer_id uuid := public.organizer_profile_id(); finale record; score integer; next_version bigint; next_phase text;
begin
  if organizer_id is null then raise exception 'Alleen de organisatie mag een land onthullen.' using errcode='42501'; end if;
  select * into finale from public.competition_finale_state where singleton_id for update;
  if finale.phase not in ('ready','revealing') or finale.reveal_order->>finale.next_index <> requested_class_code then raise exception 'Dit land is niet als volgende aan de beurt.' using errcode='22023'; end if;
  select points into score from public.competition_round_scores where class_code=requested_class_code and round_code='pov_final';
  insert into public.competition_score_events (class_code,title,category,points,awarded_by,round_code)
    values (requested_class_code,'POV-finale','POV-foto',score,organizer_id,'pov_final')
    on conflict (class_code,round_code) where round_code is not null do nothing;
  if not found then raise exception 'De POV-score voor dit land is al onthuld.' using errcode='22023'; end if;
  update public.competition_round_scores set published_at=now(), updated_at=now(), updated_by=organizer_id where class_code=requested_class_code and round_code='pov_final';
  next_phase := case when finale.next_index + 1 >= jsonb_array_length(finale.reveal_order) then 'final' else 'revealing' end;
  update public.competition_finale_state set phase=next_phase, next_index=finale.next_index+1,
    last_revealed_class_code=requested_class_code,last_revealed_points=score,reveal_sequence=reveal_sequence+1,
    revealed_at=now(),updated_at=now(),updated_by=organizer_id where singleton_id;
  update public.competition_score_state set version=version+1,updated_at=now() where singleton_id returning version into next_version;
  return jsonb_build_object('classCode',requested_class_code,'points',score,'scoreVersion',next_version,'phase',next_phase,'revealSequence',finale.reveal_sequence+1);
end $$;

create or replace function public.get_competition_finale_state()
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare state record; is_organizer boolean := public.organizer_profile_id() is not null;
begin
  if (select auth.uid()) is null then raise exception 'Log eerst in.' using errcode='42501'; end if;
  select * into state from public.competition_finale_state where singleton_id;
  return jsonb_build_object('phase',state.phase,'revealOrder',case when is_organizer then state.reveal_order else '[]'::jsonb end,
    'nextIndex',state.next_index,'lastRevealedClassCode',state.last_revealed_class_code,
    'lastRevealedPoints',state.last_revealed_points,'revealSequence',state.reveal_sequence,'revealedAt',state.revealed_at);
end $$;

-- Deelnemers mogen alleen uploaden; uitsluitend organisatoren kunnen metadata en bestanden lezen.
drop policy if exists "POV eigen klas of organisatie lezen" on public.pov_submissions;
drop policy if exists "POV eigen inzendingen of organisatie lezen" on public.pov_submissions;
create policy "Alleen organisatie leest POV-inzendingen" on public.pov_submissions for select to authenticated
using (public.organizer_profile_id() is not null);
drop policy if exists "POV eigen klas of organisatiebestand lezen" on storage.objects;
drop policy if exists "POV eigen bestand of organisatie lezen" on storage.objects;
create policy "Alleen organisatie leest POV-bestanden" on storage.objects for select to authenticated
using (bucket_id='pov-inzendingen' and public.organizer_profile_id() is not null);

revoke execute on function public.list_class_pov_submissions(text,integer) from authenticated;
revoke execute on function public.review_pov_submission_with_points(uuid,integer) from authenticated;

update storage.buckets set file_size_limit=3145728 where id='pov-inzendingen';

create or replace function public.complete_pov_upload(
  requested_submission_id uuid, submitted_caption text, submitted_original_filename text,
  submitted_byte_size integer, submitted_mime_type text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if submitted_byte_size < 1 or submitted_byte_size > 3145728 or submitted_mime_type <> 'image/jpeg' then
    raise exception 'Het geüploade bestand voldoet niet aan de foto-eisen.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.pov_submissions s join public.profiles p on p.id=s.uploader_profile_id
    join storage.objects o on o.bucket_id='pov-inzendingen' and o.name=s.storage_path
    where s.id=requested_submission_id and p.auth_user_id=(select auth.uid()) and p.active and s.status='pending'
  ) then raise exception 'Het geüploade bestand is niet gevonden.' using errcode='22023'; end if;
  update public.pov_submissions s set caption=nullif(left(btrim(submitted_caption),240),''),
    original_filename=left(submitted_original_filename,180),byte_size=submitted_byte_size,
    mime_type=submitted_mime_type,status='uploaded',uploaded_at=now()
  from public.profiles p where s.id=requested_submission_id and s.uploader_profile_id=p.id
    and p.auth_user_id=(select auth.uid()) and p.active and s.status='pending';
  if not found then raise exception 'Deze uploadreservering is niet geldig.' using errcode='42501'; end if;
end $$;

revoke all on function public.list_competition_round_scores() from public,anon;
revoke all on function public.organizer_profile_id() from public,anon;
revoke all on function public.save_competition_round_scores(text,jsonb,boolean) from public,anon;
revoke all on function public.lock_competition_finale_order(jsonb) from public,anon;
revoke all on function public.reveal_next_competition_finalist(text) from public,anon;
revoke all on function public.get_competition_finale_state() from public,anon;
grant execute on function public.list_competition_round_scores() to authenticated;
grant execute on function public.save_competition_round_scores(text,jsonb,boolean) to authenticated;
grant execute on function public.lock_competition_finale_order(jsonb) to authenticated;
grant execute on function public.reveal_next_competition_finalist(text) to authenticated;
grant execute on function public.get_competition_finale_state() to authenticated;
grant execute on function public.organizer_profile_id() to authenticated;
