-- Introweek-app: ondersteun geïnteresseerde docenten zonder klaskoppeling.
-- Voer eerst migratie 011 uit en daarna pas deze migratie.

alter table public.profiles
  drop constraint if exists profiles_student_number_by_role;

alter table public.profiles
  add constraint profiles_student_number_by_role check (
    (profile_type in ('student', 'buddy') and student_number is not null)
    or profile_type in ('poer', 'interested_teacher', 'organizer')
  );

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
    $old$not in ('student', 'buddy', 'poer', 'organizer')$old$,
    $new$not in ('student', 'buddy', 'poer', 'interested_teacher', 'organizer')$new$
  );
  v_updated := replace(
    v_updated,
    $old$((item->>'role') <> 'organizer' and nullif(btrim(item->>'classCode'), '') is null)$old$,
    $new$((item->>'role') in ('student', 'buddy', 'poer') and nullif(btrim(item->>'classCode'), '') is null)$new$
  );
  v_updated := replace(
    v_updated,
    $old$in ('poer', 'organizer')$old$,
    $new$in ('poer', 'interested_teacher', 'organizer')$new$
  );

  if v_updated = v_definition
    or position('interested_teacher' in v_updated) = 0
    or position($needle$<> 'organizer'$needle$ in v_updated) > 0
    or position($needle$in ('poer', 'organizer')$needle$ in v_updated) > 0
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
    $old$v_class_id is not null and v_profile_role <> 'organizer' and v_is_active$old$,
    $new$v_class_id is not null and v_profile_role in ('student', 'buddy', 'poer') and v_is_active$new$
  );
  v_updated := replace(
    v_updated,
    $old$in ('poer', 'organizer')$old$,
    $new$in ('poer', 'interested_teacher', 'organizer')$new$
  );

  if v_updated = v_definition
    or position('interested_teacher' in v_updated) = 0
    or position($needle$v_profile_role <> 'organizer'$needle$ in v_updated) > 0
    or position($needle$in ('poer', 'organizer')$needle$ in v_updated) > 0
  then
    raise exception 'De verwachte apply_people_import-definitie is niet gevonden; er is niets gewijzigd.';
  end if;

  execute v_updated;
end
$migration$;

comment on function public.preview_people_import_core(jsonb) is
  'Vergelijkt een genormaliseerde deelnemersimport; geïnteresseerde docenten hebben geen klas nodig.';

comment on function public.apply_people_import(jsonb, text) is
  'Verwerkt een deelnemersimport atomair; geïnteresseerde docenten worden zonder klaskoppeling ondersteund.';
