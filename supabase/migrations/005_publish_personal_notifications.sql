-- Introweek-app: publiceer uitsluitend nieuwe, persoonlijke meldingen via Realtime.
-- RLS op public.notifications blijft bepalen welke rij een gebruiker mag ontvangen.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

comment on table public.notifications is
  'Persoonlijke, via RLS afgeschermde meldingen; nieuwe rijen worden gericht via Realtime verstuurd.';
