-- Deel tijdens een finalerepetitie hetzelfde gesimuleerde tijdstip met alle
-- ingelogde rollen. Buiten de repetitie wordt nooit een klok overschreven.

alter table public.competition_score_state
  add column if not exists rehearsal_simulated_at timestamptz;

create or replace function public.sync_competition_rehearsal_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.test_reset_enabled then
    new.rehearsal_simulated_at := coalesce(
      new.rehearsal_simulated_at,
      '2026-08-27T16:15:00+02:00'::timestamptz
    );
  else
    new.rehearsal_simulated_at := null;
  end if;
  return new;
end $$;

drop trigger if exists sync_competition_rehearsal_time_trigger
on public.competition_score_state;
create trigger sync_competition_rehearsal_time_trigger
before insert or update of test_reset_enabled, rehearsal_simulated_at
on public.competition_score_state
for each row execute function public.sync_competition_rehearsal_time();

update public.competition_score_state
set rehearsal_simulated_at = case
  when test_reset_enabled then '2026-08-27T16:15:00+02:00'::timestamptz
  else null
end
where singleton_id;

create or replace function public.get_competition_finale_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  finale_state record;
  score_state record;
  is_organizer boolean := public.organizer_profile_id() is not null;
begin
  if (select auth.uid()) is null then
    raise exception 'Log eerst in.' using errcode = '42501';
  end if;

  select * into finale_state
  from public.competition_finale_state
  where singleton_id;

  select * into score_state
  from public.competition_score_state
  where singleton_id;

  return jsonb_build_object(
    'phase', finale_state.phase,
    'revealOrder', case when is_organizer then finale_state.reveal_order else '[]'::jsonb end,
    'nextIndex', finale_state.next_index,
    'lastRevealedClassCode', finale_state.last_revealed_class_code,
    'lastRevealedPoints', finale_state.last_revealed_points,
    'revealSequence', finale_state.reveal_sequence,
    'revealedAt', finale_state.revealed_at,
    'simulatedAt', case
      when score_state.test_reset_enabled then score_state.rehearsal_simulated_at
      else null
    end
  );
end $$;

revoke all on function public.sync_competition_rehearsal_time() from public, anon, authenticated;
