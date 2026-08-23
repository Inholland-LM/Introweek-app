-- De productiebeveiliging weigert DELETE zonder expliciete WHERE-clausule.
-- Houd de volledige reset functioneel door alle score-events via hun niet-lege
-- primaire sleutel te selecteren.

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
begin
  if organizer_id is null then
    raise exception 'Alleen de organisatie mag een strijdtest wissen.' using errcode = '42501';
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

revoke all on function public.reset_competition_test(text) from public, anon;
grant execute on function public.reset_competition_test(text) to authenticated;
