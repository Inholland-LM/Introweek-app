-- Organisatoren kunnen tijdelijk en bewust een finalerepetitie openen.
-- Een volledige reset sluit de repetitiemodus automatisch weer af.

create or replace function public.get_competition_rehearsal_status()
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if public.organizer_profile_id() is null then
    raise exception 'Alleen de organisatie mag de repetitiestatus bekijken.' using errcode = '42501';
  end if;

  return coalesce((
    select state.test_reset_enabled
    from public.competition_score_state state
    where state.singleton_id
  ), false);
end $$;

create or replace function public.set_competition_rehearsal_mode(
  requested_enabled boolean,
  requested_confirmation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid := public.organizer_profile_id();
  required_confirmation text := case
    when requested_enabled then 'START REPETITIE'
    else 'SLUIT REPETITIE'
  end;
begin
  if organizer_id is null then
    raise exception 'Alleen de organisatie mag de repetitiemodus wijzigen.' using errcode = '42501';
  end if;

  if requested_confirmation <> required_confirmation then
    raise exception 'De bevestiging voor de repetitiemodus klopt niet.' using errcode = '22023';
  end if;

  update public.competition_score_state
  set test_reset_enabled = requested_enabled,
      updated_at = now()
  where singleton_id;

  return requested_enabled;
end $$;

create or replace function public.reset_competition_test(requested_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid := public.organizer_profile_id();
  removed_events integer := 0;
  removed_scores integer := 0;
  cleared_pov_awards integer := 0;
  next_version bigint;
  reset_enabled boolean := false;
begin
  if organizer_id is null then
    raise exception 'Alleen de organisatie mag een strijdtest wissen.' using errcode = '42501';
  end if;

  select state.test_reset_enabled
  into reset_enabled
  from public.competition_score_state state
  where state.singleton_id
  for update;

  if not coalesce(reset_enabled, false) then
    raise exception 'Start eerst de finalerepetitie voordat je teststanden wist.' using errcode = '42501';
  end if;

  if requested_confirmation <> 'RESET STRIJD' then
    raise exception 'Typ exact RESET STRIJD om alle teststanden te wissen.' using errcode = '22023';
  end if;

  perform 1
  from public.competition_finale_state
  where singleton_id
  for update;

  delete from public.competition_score_events
  where id is not null;
  get diagnostics removed_events = row_count;

  update public.pov_submissions
  set awarded_points = 0,
      points_awarded_at = null,
      points_awarded_by = null
  where awarded_points <> 0
     or points_awarded_at is not null
     or points_awarded_by is not null;
  get diagnostics cleared_pov_awards = row_count;

  delete from public.competition_round_scores
  where round_code in ('hag', 'sx', 'city_game', 'pov_final');
  get diagnostics removed_scores = row_count;

  update public.competition_finale_state
  set phase = 'preparation',
      reveal_order = '[]'::jsonb,
      next_index = 0,
      last_revealed_class_code = null,
      last_revealed_points = null,
      reveal_sequence = 0,
      revealed_at = null,
      updated_at = now(),
      updated_by = organizer_id
  where singleton_id;

  update public.competition_score_state
  set version = version + 1,
      test_reset_enabled = false,
      updated_at = now()
  where singleton_id
  returning version into next_version;

  return jsonb_build_object(
    'removedEvents', removed_events,
    'removedScores', removed_scores,
    'clearedPovAwards', cleared_pov_awards,
    'scoreVersion', next_version
  );
end $$;

revoke all on function public.get_competition_rehearsal_status() from public, anon;
revoke all on function public.set_competition_rehearsal_mode(boolean, text) from public, anon;
revoke all on function public.reset_competition_test(text) from public, anon;

grant execute on function public.get_competition_rehearsal_status() to authenticated;
grant execute on function public.set_competition_rehearsal_mode(boolean, text) to authenticated;
grant execute on function public.reset_competition_test(text) to authenticated;
