-- Introweek-app: herstel een naamconflict in de reeds geïnstalleerde
-- apply_people_import-functie uit migratie 003.
--
-- Nieuwe installaties krijgen de gecorrigeerde functie rechtstreeks uit 003.
-- Deze kleine migratie past bestaande installaties veilig op hun plek aan.

do $migration$
declare
  v_function_definition text;
  v_corrected_definition text;
begin
  select pg_get_functiondef(
    'public.apply_people_import(jsonb,text)'::regprocedure
  ) into v_function_definition;

  v_corrected_definition := replace(
    v_function_definition,
    $old$from jsonb_array_elements(import_rows) source(item)
        where (p.profile_type in ('student', 'buddy') and btrim(item->>'studentNumber') = p.student_number)
           or (p.profile_type in ('poer', 'organizer') and lower(btrim(item->>'email')) = p.email)$old$,
    $new$from jsonb_array_elements(import_rows) source(imported_item)
        where (p.profile_type in ('student', 'buddy') and btrim(imported_item->>'studentNumber') = p.student_number)
           or (p.profile_type in ('poer', 'organizer') and lower(btrim(imported_item->>'email')) = p.email)$new$
  );

  if v_corrected_definition = v_function_definition then
    if position('source(imported_item)' in v_function_definition) > 0 then
      raise notice 'apply_people_import bevat de correctie al.';
      return;
    end if;

    raise exception 'De verwachte apply_people_import-definitie is niet gevonden; er is niets gewijzigd.';
  end if;

  execute v_corrected_definition;
end
$migration$;

comment on function public.apply_people_import(jsonb, text) is
  'Verwerkt een bevestigde deelnemersimport atomair en maakt gerichte meldingen voor klaswisselingen.';
