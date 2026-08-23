-- Een directe wijziging van iemands klas is persoonlijk en tijdkritisch.
-- De bestaande importfunctie maakt zo'n rij nog met de oude standaard
-- `in-app`; normaliseer uitsluitend dit type naar beide kanalen.

create or replace function private.set_personal_notification_delivery_channel()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'class_changed' then
    new.delivery_channel := 'both';
  end if;
  return new;
end $$;

drop trigger if exists set_personal_notification_delivery_channel_trigger
on public.notifications;
create trigger set_personal_notification_delivery_channel_trigger
before insert on public.notifications
for each row execute function private.set_personal_notification_delivery_channel();

revoke all on function private.set_personal_notification_delivery_channel()
from public, anon, authenticated;
