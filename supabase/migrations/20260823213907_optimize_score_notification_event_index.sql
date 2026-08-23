-- Zet het score-event vooraan zodat dezelfde unieke index ook de
-- ON DELETE CASCADE-controle van de foreign key efficiënt ondersteunt.

drop index if exists public.notifications_recipient_score_event_idx;

create unique index notifications_score_event_recipient_idx
  on public.notifications (competition_score_event_id, recipient_profile_id)
  where competition_score_event_id is not null;
