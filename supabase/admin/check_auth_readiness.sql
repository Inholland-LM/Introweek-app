-- Alleen-lezen controle voor de authenticatie-release.
-- Deze query toont uitsluitend totalen en wijzigt niets.

select
  count(*) filter (where p.active) as actieve_profielen,
  count(*) filter (where p.active and p.auth_user_id is not null) as gekoppelde_profielen,
  count(*) filter (where p.active and p.auth_user_id is null) as nog_niet_gekoppeld,
  count(*) filter (
    where p.active
      and p.profile_type = 'organizer'
      and p.auth_user_id is not null
  ) as gekoppelde_organisatoren
from public.profiles p;

select
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) as meldingen_realtime_actief,
  has_function_privilege(
    'authenticated',
    'public.preview_people_import(jsonb)',
    'EXECUTE'
  ) as import_voorvertoning_beschikbaar,
  has_function_privilege(
    'authenticated',
    'public.apply_people_import(jsonb,text)',
    'EXECUTE'
  ) as import_verwerken_beschikbaar;
