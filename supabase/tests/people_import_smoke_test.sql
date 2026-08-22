-- Veilige end-to-endtest voor deelnemersimport.
--
-- Voer dit volledige bestand in een keer uit in de Supabase SQL Editor.
-- Alles gebeurt binnen een transactie die onderaan altijd wordt teruggedraaid.
-- Bij succes verschijnt uitsluitend de PASS-regel als laatste resultaat.

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'codex-smoketest-organizer@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (
  auth_user_id,
  email,
  first_name,
  last_name,
  profile_type,
  active
) values (
  '10000000-0000-4000-8000-000000000001',
  'codex-smoketest-organizer@example.invalid',
  'Test',
  'Organisator',
  'organizer',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $smoke_test$
declare
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object(
      'studentNumber', null,
      'firstName', 'Test',
      'namePrefix', null,
      'lastName', 'Organisator',
      'email', 'codex-smoketest-organizer@example.invalid',
      'role', 'organizer',
      'classCode', null,
      'active', true
    ),
    jsonb_build_object(
      'studentNumber', 'SMOKE-BUDDY-001',
      'firstName', 'Test',
      'namePrefix', null,
      'lastName', 'Buddy',
      'email', 'codex-smoketest-buddy@example.invalid',
      'role', 'buddy',
      'classCode', 'LM1A',
      'active', true
    ),
    jsonb_build_object(
      'studentNumber', null,
      'firstName', 'Test',
      'namePrefix', null,
      'lastName', 'PO-er',
      'email', 'codex-smoketest-poer@example.invalid',
      'role', 'poer',
      'classCode', 'LM1A',
      'active', true
    ),
    jsonb_build_object(
      'studentNumber', 'SMOKE-STUDENT-001',
      'firstName', 'Test',
      'namePrefix', null,
      'lastName', 'Student',
      'email', 'codex-smoketest-student@example.invalid',
      'role', 'student',
      'classCode', 'LM1A',
      'active', true
    )
  );
  v_preview jsonb;
  v_conflict_preview jsonb;
  v_applied jsonb;
  v_import_id uuid;
begin
  if not has_function_privilege(
    'authenticated',
    'public.preview_people_import(jsonb)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated mist EXECUTE op preview_people_import.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.apply_people_import(jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated mist EXECUTE op apply_people_import.';
  end if;

  v_preview := public.preview_people_import(v_rows);

  if coalesce(v_preview->>'stateVersion', '') = '' then
    raise exception 'FAIL: de vergelijking bevat geen stateVersion.';
  end if;

  if (v_preview->>'totalIncoming')::integer <> 4 then
    raise exception 'FAIL: verwachtte 4 inkomende personen, kreeg %.',
      v_preview->>'totalIncoming';
  end if;

  if (v_preview->>'conflicts')::integer <> 0 then
    raise exception 'FAIL: de fictieve import bevat onverwachte conflicten: %.',
      v_preview->>'conflicts';
  end if;

  v_applied := public.apply_people_import(
    v_rows,
    v_preview->>'stateVersion'
  );
  v_import_id := (v_applied->>'importId')::uuid;

  if v_import_id is null then
    raise exception 'FAIL: apply_people_import gaf geen importId terug.';
  end if;

  if (
    select count(*)
    from public.profiles p
    where p.email like 'codex-smoketest-%@example.invalid'
      and p.active = true
  ) <> 4 then
    raise exception 'FAIL: niet alle 4 fictieve profielen zijn actief verwerkt.';
  end if;

  v_conflict_preview := public.preview_people_import(jsonb_build_array(
    jsonb_build_object(
      'studentNumber', 'SMOKE-STUDENT-NEW-KEY',
      'firstName', 'Andere',
      'namePrefix', null,
      'lastName', 'Persoon',
      'email', 'codex-smoketest-student@example.invalid',
      'role', 'student',
      'classCode', 'LM1B',
      'active', true
    )
  ));

  if (v_conflict_preview->>'conflicts')::integer <> 1
    or v_conflict_preview#>>'{changes,0,conflictReason}' <> 'email_in_use'
    or v_conflict_preview#>>'{changes,0,conflictingIdentifier}' <> 'SMOKE-STUDENT-001'
    or v_conflict_preview#>>'{changes,0,previousValues,email}' <> 'codex-smoketest-student@example.invalid'
  then
    raise exception 'FAIL: e-mailconflict bevat niet de concrete bestaande identiteit: %.',
      v_conflict_preview->'changes';
  end if;

  if (
    select count(*)
    from public.class_memberships cm
    join public.profiles p on p.id = cm.profile_id
    join public.classes c on c.id = cm.class_id
    where p.email in (
      'codex-smoketest-buddy@example.invalid',
      'codex-smoketest-poer@example.invalid',
      'codex-smoketest-student@example.invalid'
    )
      and c.code = 'LM1A'
      and cm.active = true
  ) <> 3 then
    raise exception 'FAIL: buddy, PO-er en student zijn niet alle drie actief aan LM1A gekoppeld.';
  end if;

  if not exists (
    select 1
    from public.people_imports pi
    where pi.id = v_import_id
      and pi.total_incoming = 4
      and pi.state_version_after is not null
  ) then
    raise exception 'FAIL: het auditrecord is niet volledig opgeslagen.';
  end if;

  if not exists (
    select 1
    from public.notifications n
    join public.profiles p on p.id = n.recipient_profile_id
    where n.import_id = v_import_id
      and n.kind = 'welcome'
      and p.email = 'codex-smoketest-student@example.invalid'
  ) then
    raise exception 'FAIL: de student ontving geen welkomstmelding.';
  end if;

  if (
    select count(distinct p.email)
    from public.notifications n
    join public.profiles p on p.id = n.recipient_profile_id
    where n.import_id = v_import_id
      and n.kind = 'class_member_arrived'
      and p.email in (
        'codex-smoketest-buddy@example.invalid',
        'codex-smoketest-poer@example.invalid'
      )
  ) <> 2 then
    raise exception 'FAIL: buddy en PO-er ontvingen niet allebei een melding over de nieuwe student.';
  end if;
end
$smoke_test$;

rollback;

select 'PASS: vergelijking, import, klasindeling, audit en meldingen werken; alle testdata is teruggedraaid.' as result;
