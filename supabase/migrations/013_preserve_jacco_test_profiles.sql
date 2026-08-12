-- Introweek-app: houd de herkenbare Jacco-testaccounts buiten het Excelbeheer.
--
-- De deelnemersimport blijft voor alle gewone profielen leidend. Alleen adressen
-- van de vorm jacco.borsch+...@inholland.nl worden niet gedeactiveerd wanneer
-- zij niet in het masterbestand staan. Zo blijven testrollen bruikbaar.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.preview_people_import_core(jsonb)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$where p.active = true
      and not exists ($old$,
    $new$where p.active = true
      and lower(p.email) not like 'jacco.borsch+%@inholland.nl'
      and not exists ($new$
  );

  if v_updated = v_definition
    or position($needle$lower(p.email) not like 'jacco.borsch+%@inholland.nl'$needle$ in v_updated) = 0
  then
    raise exception 'De verwachte preview_people_import_core-definitie is niet gevonden; er is niets gewijzigd.';
  end if;

  execute v_updated;
end
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.apply_people_import(jsonb,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$where p.active = true
      and not exists ($old$,
    $new$where p.active = true
      and lower(p.email) not like 'jacco.borsch+%@inholland.nl'
      and not exists ($new$
  );

  if v_updated = v_definition
    or position($needle$lower(p.email) not like 'jacco.borsch+%@inholland.nl'$needle$ in v_updated) = 0
  then
    raise exception 'De verwachte apply_people_import-definitie is niet gevonden; er is niets gewijzigd.';
  end if;

  execute v_updated;
end
$migration$;

-- Herstel bestaande testprofielen die door een eerdere import zijn uitgezet.
update public.profiles
set active = true,
    updated_at = now()
where lower(email) like 'jacco.borsch+%@inholland.nl';

-- Herstel voor klasgebonden testrollen uitsluitend hun laatst gebruikte relatie.
with latest_membership as (
  select distinct on (membership.profile_id)
    membership.id
  from public.class_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where lower(profile.email) like 'jacco.borsch+%@inholland.nl'
    and profile.profile_type in ('student', 'buddy', 'poer')
  order by
    membership.profile_id,
    membership.updated_at desc,
    membership.created_at desc
)
update public.class_memberships membership
set active = true,
    updated_at = now()
where membership.id in (select id from latest_membership);

comment on function public.preview_people_import_core(jsonb) is
  'Vergelijkt een genormaliseerde deelnemersimport; herkenbare Jacco-testaliassen blijven buiten deactivatie.';

comment on function public.apply_people_import(jsonb, text) is
  'Verwerkt een deelnemersimport atomair; herkenbare Jacco-testaliassen blijven bruikbaar buiten het masterbestand.';
