-- Koppel iedere persoonlijke puntenmelding aan het onderliggende score-event.
-- Daardoor is één publicatie idempotent en verdwijnen repetitiemeldingen
-- automatisch wanneer RESET STRIJD de test-score-events wist.

alter table public.notifications
  add column if not exists competition_score_event_id uuid
    references public.competition_score_events(id) on delete cascade;

create unique index if not exists notifications_recipient_score_event_idx
  on public.notifications (recipient_profile_id, competition_score_event_id)
  where competition_score_event_id is not null;

create or replace function private.notify_competition_score_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_label text := case new.round_code
    when 'hag' then 'HAG'
    when 'sx' then 'Sports Experiences'
    when 'city_game' then 'City Game'
    when 'pov_final' then 'POV-finale'
    else new.title
  end;
  notification_title text := case new.round_code
    when 'pov_final' then '🏆 Finale-punten onthuld'
    else '🏆 ' || coalesce(round_label, 'Nieuwe') || '-punten gepubliceerd'
  end;
begin
  insert into public.notifications (
    recipient_profile_id,
    kind,
    title,
    body,
    delivery_channel,
    action_target,
    source_class_code,
    source_audience_label,
    competition_score_event_id
  )
  select distinct
    profile.id,
    'broadcast',
    notification_title,
    'Jullie klas ' || new.class_code || ' heeft ' || new.points ||
      case when new.points = 1 then ' punt' else ' punten' end ||
      ' gekregen voor ' || coalesce(round_label, 'de Landenstrijd') ||
      '. Bekijk de actuele stand bij Strijd.',
    'both',
    'notifications',
    new.class_code,
    'Ontvangen als lid van ' || new.class_code,
    new.id
  from public.profiles profile
  join public.class_memberships membership
    on membership.profile_id = profile.id
   and membership.active = true
  join public.classes class
    on class.id = membership.class_id
   and class.active = true
  where profile.active = true
    and profile.profile_type in ('student', 'buddy', 'poer')
    and class.code = new.class_code
  on conflict (recipient_profile_id, competition_score_event_id)
    where competition_score_event_id is not null
    do nothing;

  return new;
end $$;

drop trigger if exists notify_competition_score_event_trigger
on public.competition_score_events;
create trigger notify_competition_score_event_trigger
after insert on public.competition_score_events
for each row execute function private.notify_competition_score_event();

-- Maak ook voor reeds gepubliceerde testpunten een inboxmelding. De unieke
-- index voorkomt dubbelen als deze migratie opnieuw wordt uitgevoerd.
insert into public.notifications (
  recipient_profile_id,
  kind,
  title,
  body,
  delivery_channel,
  action_target,
  source_class_code,
  source_audience_label,
  competition_score_event_id
)
select distinct
  profile.id,
  'broadcast',
  case score.round_code
    when 'pov_final' then '🏆 Finale-punten onthuld'
    else '🏆 ' || coalesce(
      case score.round_code
        when 'hag' then 'HAG'
        when 'sx' then 'Sports Experiences'
        when 'city_game' then 'City Game'
      end,
      score.title,
      'Nieuwe'
    ) || '-punten gepubliceerd'
  end,
  'Jullie klas ' || score.class_code || ' heeft ' || score.points ||
    case when score.points = 1 then ' punt' else ' punten' end ||
    ' gekregen voor ' || coalesce(
      case score.round_code
        when 'hag' then 'HAG'
        when 'sx' then 'Sports Experiences'
        when 'city_game' then 'City Game'
        when 'pov_final' then 'POV-finale'
      end,
      score.title,
      'de Landenstrijd'
    ) || '. Bekijk de actuele stand bij Strijd.',
  'both',
  'notifications',
  score.class_code,
  'Ontvangen als lid van ' || score.class_code,
  score.id
from public.competition_score_events score
join public.classes class on class.code = score.class_code and class.active = true
join public.class_memberships membership on membership.class_id = class.id and membership.active = true
join public.profiles profile on profile.id = membership.profile_id and profile.active = true
where profile.profile_type in ('student', 'buddy', 'poer')
on conflict (recipient_profile_id, competition_score_event_id)
  where competition_score_event_id is not null
  do nothing;

revoke all on function private.notify_competition_score_event() from public, anon, authenticated;
