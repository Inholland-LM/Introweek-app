-- EENMALIG HULPSCRIPT: maak het eerste organisatorprofiel aan.
-- Dit is bewust geen migratie en wordt nooit automatisch uitgevoerd.
--
-- 1. Vervang uitsluitend de drie waarden hieronder.
-- 2. Voer het volledige bestand uit in de Supabase SQL Editor.
-- 3. Maak daarna onder Authentication > Users een gebruiker met exact
--    hetzelfde genormaliseerde e-mailadres. De bestaande trigger koppelt beide.

do $bootstrap$
declare
  v_email constant text := lower(btrim('VUL_HIER_HET_EMAILADRES_IN'));
  v_first_name constant text := btrim('VUL_HIER_DE_VOORNAAM_IN');
  v_last_name constant text := btrim('VUL_HIER_DE_ACHTERNAAM_IN');
  v_auth_user_id uuid;
begin
  if v_email = 'vul_hier_het_emailadres_in'
     or v_first_name = 'VUL_HIER_DE_VOORNAAM_IN'
     or v_last_name = 'VUL_HIER_DE_ACHTERNAAM_IN' then
    raise exception 'Vul eerst e-mailadres, voornaam en achternaam bovenaan het script in.';
  end if;

  if position('@' in v_email) < 2
     or length(v_email) > 320
     or length(v_first_name) > 100
     or length(v_last_name) > 100 then
    raise exception 'Het e-mailadres of de naam is ongeldig.';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.email = v_email
  ) then
    raise exception 'Er bestaat al een profiel met %. Er is niets gewijzigd.', v_email;
  end if;

  select u.id into v_auth_user_id
  from auth.users u
  where lower(btrim(u.email)) = v_email
  limit 1;

  insert into public.profiles (
    auth_user_id,
    email,
    student_number,
    first_name,
    name_prefix,
    last_name,
    profile_type,
    active
  ) values (
    v_auth_user_id,
    v_email,
    null,
    v_first_name,
    null,
    v_last_name,
    'organizer',
    true
  );

  if v_auth_user_id is null then
    raise notice 'Organisatorprofiel aangemaakt. Maak nu de Auth-gebruiker met exact % aan.', v_email;
  else
    raise notice 'Organisatorprofiel aangemaakt en gekoppeld aan de bestaande Auth-gebruiker.';
  end if;
end
$bootstrap$;
