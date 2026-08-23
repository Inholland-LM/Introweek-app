-- Geef de organisatie een gecontroleerde manier om een volledige finalerepetitie
-- te wissen. Alleen POV-finaledata wordt teruggedraaid; eerdere rondes blijven staan.

create function public.reset_competition_finale_test(requested_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid := public.organizer_profile_id();
  removed_events integer := 0;
  removed_scores integer := 0;
  next_version bigint;
begin
  if organizer_id is null then
    raise exception 'Alleen de organisatie mag een finaletest wissen.' using errcode = '42501';
  end if;
  if requested_confirmation <> 'RESET FINALE' then
    raise exception 'Typ exact RESET FINALE om de finaletest te wissen.' using errcode = '22023';
  end if;

  -- Serialiseer resetten met vastzetten/onthullen, zodat een gelijktijdige actie
  -- niet half voor of half na de reset kan belanden.
  perform 1
  from public.competition_finale_state
  where singleton_id
  for update;

  delete from public.competition_score_events
  where round_code = 'pov_final';
  get diagnostics removed_events = row_count;

  delete from public.competition_round_scores
  where round_code = 'pov_final';
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
    'scoreVersion', next_version
  );
end $$;

revoke all on function public.reset_competition_finale_test(text) from public, anon;
grant execute on function public.reset_competition_finale_test(text) to authenticated;
