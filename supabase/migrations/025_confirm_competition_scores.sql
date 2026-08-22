-- Laat de organisatie iedere klassenscore expliciet controleren voordat een ronde
-- als één geheel wordt gepubliceerd. De POV-finale krijgt daarnaast een aparte
-- controle op het moment van de live onthulling.

alter table public.competition_round_scores
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.profiles(id),
  add column if not exists revision bigint not null default 0,
  add column if not exists published_by uuid references public.profiles(id),
  add column if not exists reveal_confirmed_at timestamptz,
  add column if not exists reveal_confirmed_by uuid references public.profiles(id);

alter table public.competition_round_scores
  drop constraint if exists competition_round_scores_confirmation_pair;
alter table public.competition_round_scores
  add constraint competition_round_scores_confirmation_pair
  check ((confirmed_at is null) = (confirmed_by is null));

alter table public.competition_round_scores
  drop constraint if exists competition_round_scores_reveal_confirmation_pair;
alter table public.competition_round_scores
  add constraint competition_round_scores_reveal_confirmation_pair
  check ((reveal_confirmed_at is null) = (reveal_confirmed_by is null));

create index if not exists competition_round_scores_confirmed_by_idx
  on public.competition_round_scores (confirmed_by) where confirmed_by is not null;
create index if not exists competition_round_scores_published_by_idx
  on public.competition_round_scores (published_by) where published_by is not null;
create index if not exists competition_round_scores_reveal_confirmed_by_idx
  on public.competition_round_scores (reveal_confirmed_by) where reveal_confirmed_by is not null;

revoke execute on function public.list_competition_round_scores() from authenticated;
drop function public.list_competition_round_scores();

create function public.list_competition_round_scores()
returns table (
  class_code text,
  round_code text,
  points integer,
  confirmed boolean,
  published boolean,
  revision bigint
)
language plpgsql security definer set search_path = '' stable as $$
begin
  if public.organizer_profile_id() is null then
    raise exception 'Alleen de organisatie mag conceptscores bekijken.' using errcode = '42501';
  end if;

  return query
    select
      s.class_code,
      s.round_code,
      s.points,
      s.confirmed_at is not null,
      s.published_at is not null,
      s.revision
    from public.competition_round_scores s;
end $$;

create or replace function public.save_competition_round_scores(
  requested_round_code text,
  requested_scores jsonb,
  requested_publish boolean default false
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  organizer_id uuid := public.organizer_profile_id();
  item jsonb;
  existing_score public.competition_round_scores%rowtype;
  class_code_value text;
  points_value integer;
  confirmed_value boolean;
  expected_revision bigint;
  active_count integer;
  changed boolean := false;
  next_version bigint;
begin
  if organizer_id is null then
    raise exception 'Alleen de organisatie mag punten beheren.' using errcode = '42501';
  end if;
  if requested_round_code not in ('hag', 'sx', 'city_game', 'pov_final') then
    raise exception 'Onbekende scoreronde.' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_scores) <> 'array' or jsonb_array_length(requested_scores) = 0 then
    raise exception 'Lever minimaal één klassenscore aan.' using errcode = '22023';
  end if;
  if (select count(distinct value->>'classCode') from jsonb_array_elements(requested_scores)) <> jsonb_array_length(requested_scores) then
    raise exception 'Iedere klas mag maar één keer in de scorelijst staan.' using errcode = '22023';
  end if;

  select count(*) into active_count from public.classes where active;
  if requested_publish and requested_round_code = 'pov_final' then
    raise exception 'POV-scores worden uitsluitend tijdens de BLEND-finale per klas onthuld.' using errcode = '22023';
  end if;
  if requested_publish and (
    jsonb_array_length(requested_scores) <> active_count
    or exists (select 1 from jsonb_array_elements(requested_scores) value where coalesce((value->>'confirmed')::boolean, false) is not true)
  ) then
    raise exception 'Publiceren kan pas wanneer iedere actieve klas exact één bevestigde score heeft.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(requested_scores) loop
    class_code_value := item->>'classCode';
    points_value := (item->>'points')::integer;
    confirmed_value := coalesce((item->>'confirmed')::boolean, false);
    expected_revision := coalesce((item->>'revision')::bigint, 0);

    if not exists (select 1 from public.classes c where c.code = class_code_value and c.active) then
      raise exception 'Onbekende of inactieve klas: %.', class_code_value using errcode = '22023';
    end if;
    if points_value not between 0 and 10000 then
      raise exception 'Punten moeten tussen 0 en 10.000 liggen.' using errcode = '22023';
    end if;

    select * into existing_score
    from public.competition_round_scores
    where class_code = class_code_value and round_code = requested_round_code
    for update;

    if found then
      if existing_score.revision <> expected_revision then
        raise exception 'De score van % is intussen door iemand anders gewijzigd. Vernieuw het scherm en controleer opnieuw.', class_code_value using errcode = '40001';
      end if;
      if existing_score.published_at is not null and (existing_score.points <> points_value or not confirmed_value) then
        raise exception 'De gepubliceerde score van % kan niet via het conceptscherm worden gewijzigd.', class_code_value using errcode = '22023';
      end if;
      if existing_score.confirmed_at is not null and confirmed_value and existing_score.points <> points_value then
        raise exception 'Hef eerst de bevestiging van % op voordat je de punten wijzigt.', class_code_value using errcode = '22023';
      end if;

      if existing_score.points <> points_value
        or (existing_score.confirmed_at is not null) <> confirmed_value
      then
        update public.competition_round_scores
        set points = points_value,
            confirmed_at = case when confirmed_value then now() end,
            confirmed_by = case when confirmed_value then organizer_id end,
            revision = revision + 1,
            updated_at = now(),
            updated_by = organizer_id
        where class_code = class_code_value and round_code = requested_round_code;
      end if;
    else
      if expected_revision <> 0 then
        raise exception 'De score van % bestaat niet meer. Vernieuw het scherm.', class_code_value using errcode = '40001';
      end if;
      insert into public.competition_round_scores (
        class_code, round_code, points, confirmed_at, confirmed_by, revision, updated_by
      ) values (
        class_code_value,
        requested_round_code,
        points_value,
        case when confirmed_value then now() end,
        case when confirmed_value then organizer_id end,
        1,
        organizer_id
      );
    end if;
  end loop;

  if requested_publish then
    if (
      select count(*)
      from public.competition_round_scores s
      join public.classes c on c.code = s.class_code and c.active
      where s.round_code = requested_round_code and s.confirmed_at is not null
    ) <> active_count then
      raise exception 'Publiceren kan pas wanneer alle actieve klassen bevestigd zijn.' using errcode = '22023';
    end if;

    update public.competition_round_scores
    set published_at = coalesce(published_at, now()),
        published_by = coalesce(published_by, organizer_id),
        updated_at = now(),
        updated_by = organizer_id
    where round_code = requested_round_code
      and class_code in (select code from public.classes where active);

    insert into public.competition_score_events (class_code, title, category, points, awarded_by, round_code)
    select
      s.class_code,
      case requested_round_code
        when 'hag' then 'HAG'
        when 'sx' then 'Sports Experiences'
        else 'City Game'
      end,
      case requested_round_code when 'city_game' then 'City Game' else 'Experience' end,
      s.points,
      organizer_id,
      requested_round_code
    from public.competition_round_scores s
    join public.classes c on c.code = s.class_code and c.active
    where s.round_code = requested_round_code
    on conflict (class_code, round_code) where round_code is not null
    do update set points = excluded.points, awarded_at = now(), awarded_by = organizer_id;

    changed := true;
  end if;

  if changed then
    update public.competition_score_state
    set version = version + 1, updated_at = now()
    where singleton_id
    returning version into next_version;
  else
    select version into next_version from public.competition_score_state where singleton_id;
  end if;

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
  if (
    select count(*) from public.competition_round_scores s
    join public.classes c on c.code=s.class_code and c.active
    where s.round_code='pov_final' and s.confirmed_at is not null
  ) <> active_count then
    raise exception 'Bevestig eerst voor iedere klas de geheime POV-eindscore.' using errcode='22023';
  end if;
  if (
    select count(*) from public.competition_round_scores s
    join public.classes c on c.code=s.class_code and c.active
    where s.round_code='city_game' and s.published_at is not null
  ) <> active_count then
    raise exception 'Publiceer eerst de City Game-score voor alle klassen.' using errcode='22023';
  end if;
  update public.competition_finale_state set phase='ready', reveal_order=requested_order, next_index=0,
    last_revealed_class_code=null, last_revealed_points=null, revealed_at=null, updated_at=now(), updated_by=organizer_id where singleton_id;
end $$;

revoke execute on function public.reveal_next_competition_finalist(text) from authenticated;
drop function public.reveal_next_competition_finalist(text);

create function public.reveal_next_competition_finalist(
  requested_class_code text,
  requested_confirmation boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare organizer_id uuid := public.organizer_profile_id(); finale record; score integer; next_version bigint; next_phase text;
begin
  if organizer_id is null then raise exception 'Alleen de organisatie mag een land onthullen.' using errcode='42501'; end if;
  if requested_confirmation is not true then raise exception 'Bevestig eerst dat het juiste land en puntenaantal klaarstaan.' using errcode='22023'; end if;
  select * into finale from public.competition_finale_state where singleton_id for update;
  if finale.phase not in ('ready','revealing') or finale.reveal_order->>finale.next_index <> requested_class_code then raise exception 'Dit land is niet als volgende aan de beurt.' using errcode='22023'; end if;
  select points into score from public.competition_round_scores
  where class_code=requested_class_code and round_code='pov_final' and confirmed_at is not null
  for update;
  if score is null then raise exception 'De bevestigde POV-score voor dit land ontbreekt.' using errcode='22023'; end if;
  insert into public.competition_score_events (class_code,title,category,points,awarded_by,round_code)
    values (requested_class_code,'POV-finale','POV-foto',score,organizer_id,'pov_final')
    on conflict (class_code,round_code) where round_code is not null do nothing;
  if not found then raise exception 'De POV-score voor dit land is al onthuld.' using errcode='22023'; end if;
  update public.competition_round_scores
    set published_at=now(), published_by=organizer_id,
        reveal_confirmed_at=now(), reveal_confirmed_by=organizer_id,
        updated_at=now(), updated_by=organizer_id
    where class_code=requested_class_code and round_code='pov_final';
  next_phase := case when finale.next_index + 1 >= jsonb_array_length(finale.reveal_order) then 'final' else 'revealing' end;
  update public.competition_finale_state set phase=next_phase, next_index=finale.next_index+1,
    last_revealed_class_code=requested_class_code,last_revealed_points=score,reveal_sequence=reveal_sequence+1,
    revealed_at=now(),updated_at=now(),updated_by=organizer_id where singleton_id;
  update public.competition_score_state set version=version+1,updated_at=now() where singleton_id returning version into next_version;
  return jsonb_build_object('classCode',requested_class_code,'points',score,'scoreVersion',next_version,'phase',next_phase,'revealSequence',finale.reveal_sequence+1);
end $$;

revoke all on function public.list_competition_round_scores() from public, anon;
revoke all on function public.save_competition_round_scores(text, jsonb, boolean) from public, anon;
revoke all on function public.lock_competition_finale_order(jsonb) from public, anon;
revoke all on function public.reveal_next_competition_finalist(text, boolean) from public, anon;
grant execute on function public.list_competition_round_scores() to authenticated;
grant execute on function public.save_competition_round_scores(text, jsonb, boolean) to authenticated;
grant execute on function public.lock_competition_finale_order(jsonb) to authenticated;
grant execute on function public.reveal_next_competition_finalist(text, boolean) to authenticated;
