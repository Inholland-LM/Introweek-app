-- Veilige RLS- en Realtime-smoketest met twee fictieve gebruikers.
--
-- Voer dit volledige bestand in een keer uit in de Supabase SQL Editor.
-- De afsluitende ROLLBACK verwijdert alle fictieve gebruikers en gegevens.

begin;

do $publication_check$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    raise exception 'FAIL: public.notifications staat niet in de Realtime-publicatie.';
  end if;
end
$publication_check$;

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
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'codex-isolation-a@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'codex-isolation-b@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  id,
  auth_user_id,
  email,
  student_number,
  first_name,
  last_name,
  profile_type,
  active
) values
  (
    '21000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'codex-isolation-a@example.invalid',
    'ISOLATION-A',
    'Test',
    'Gebruiker A',
    'student',
    true
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'codex-isolation-b@example.invalid',
    'ISOLATION-B',
    'Test',
    'Gebruiker B',
    'student',
    true
  );

insert into public.class_memberships (
  profile_id,
  class_id,
  membership_role,
  active
)
select
  source.profile_id,
  c.id,
  'student',
  true
from (
  values
    ('21000000-0000-4000-8000-000000000001'::uuid),
    ('21000000-0000-4000-8000-000000000002'::uuid)
) source(profile_id)
cross join public.classes c
where c.code = 'LM1A';

insert into public.notifications (
  id,
  recipient_profile_id,
  kind,
  title,
  body
) values
  (
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'welcome',
    'Alleen voor gebruiker A',
    'Deze melding mag uitsluitend gebruiker A zien.'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    'welcome',
    'Alleen voor gebruiker B',
    'Deze melding mag uitsluitend gebruiker B zien.'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000001',
  true
);

do $user_a_checks$
declare
  v_updated_rows integer;
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: gebruiker A kan meer of minder dan het eigen profiel lezen.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.auth_user_id = '20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: gebruiker A kan het eigen profiel niet lezen.';
  end if;

  if (select count(*) from public.class_memberships) <> 1 then
    raise exception 'FAIL: gebruiker A kan een vreemde klasrelatie lezen.';
  end if;

  if (select count(*) from public.notifications) <> 1 then
    raise exception 'FAIL: gebruiker A kan meer of minder dan de eigen melding lezen.';
  end if;

  if not exists (
    select 1
    from public.notifications n
    where n.id = '22000000-0000-4000-8000-000000000001'
      and n.title = 'Alleen voor gebruiker A'
  ) then
    raise exception 'FAIL: gebruiker A kan de eigen melding niet lezen.';
  end if;

  update public.notifications
  set read_at = now()
  where id = '22000000-0000-4000-8000-000000000001';
  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'FAIL: gebruiker A kan de eigen melding niet als gelezen markeren.';
  end if;

  update public.notifications
  set read_at = now()
  where id = '22000000-0000-4000-8000-000000000002';
  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 0 then
    raise exception 'FAIL: gebruiker A kan de melding van gebruiker B wijzigen.';
  end if;
end
$user_a_checks$;

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);

do $user_b_checks$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: gebruiker B kan meer of minder dan het eigen profiel lezen.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.auth_user_id = '20000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'FAIL: gebruiker B kan het eigen profiel niet lezen.';
  end if;

  if (select count(*) from public.class_memberships) <> 1 then
    raise exception 'FAIL: gebruiker B kan een vreemde klasrelatie lezen.';
  end if;

  if (select count(*) from public.notifications) <> 1 then
    raise exception 'FAIL: gebruiker B kan meer of minder dan de eigen melding lezen.';
  end if;

  if not exists (
    select 1
    from public.notifications n
    where n.id = '22000000-0000-4000-8000-000000000002'
      and n.title = 'Alleen voor gebruiker B'
      and n.read_at is null
  ) then
    raise exception 'FAIL: gebruiker B kan de eigen, ongelezen melding niet lezen.';
  end if;
end
$user_b_checks$;

reset role;
rollback;

select 'PASS: Realtime-publicatie en afscherming van profielen, klasrelaties en meldingen werken; alle testdata is teruggedraaid.' as result;
