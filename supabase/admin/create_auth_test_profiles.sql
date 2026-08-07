-- EENMALIGE TESTSET voor de authenticatie- en privacycontrole.
--
-- Dit script maakt drie duidelijk herkenbare testprofielen aan en koppelt ze
-- aan LM1A. Het kan veilig nogmaals worden uitgevoerd: bestaande testprofielen
-- worden bijgewerkt en er ontstaan geen dubbele klasrelaties.
--
-- Voer dit script uit VOORDAT de drie gelijknamige Auth-gebruikers worden
-- aangemaakt. De bestaande trigger koppelt de Auth-gebruikers daarna vanzelf.

insert into public.profiles (
  auth_user_id,
  email,
  student_number,
  first_name,
  name_prefix,
  last_name,
  profile_type,
  active
)
values
  (
    (select id from auth.users where lower(btrim(email)) = 'jacco.borsch+student@inholland.nl' limit 1),
    'jacco.borsch+student@inholland.nl',
    'TEST-STUDENT-001',
    'Sofie',
    null,
    'Teststudent',
    'student',
    true
  ),
  (
    (select id from auth.users where lower(btrim(email)) = 'jacco.borsch+buddy@inholland.nl' limit 1),
    'jacco.borsch+buddy@inholland.nl',
    'TEST-BUDDY-001',
    'Bo',
    null,
    'Testbuddy',
    'buddy',
    true
  ),
  (
    (select id from auth.users where lower(btrim(email)) = 'jacco.borsch+poer@inholland.nl' limit 1),
    'jacco.borsch+poer@inholland.nl',
    null,
    'Puck',
    null,
    'Test-POer',
    'poer',
    true
  )
on conflict (email) do update
set student_number = excluded.student_number,
    first_name = excluded.first_name,
    name_prefix = excluded.name_prefix,
    last_name = excluded.last_name,
    profile_type = excluded.profile_type,
    active = true,
    auth_user_id = coalesce(public.profiles.auth_user_id, excluded.auth_user_id),
    updated_at = now();

-- De drie testgebruikers horen tijdens deze controle uitsluitend bij LM1A.
update public.class_memberships membership
set active = false,
    updated_at = now()
where membership.profile_id in (
  select profile.id
  from public.profiles profile
  where profile.email in (
    'jacco.borsch+student@inholland.nl',
    'jacco.borsch+buddy@inholland.nl',
    'jacco.borsch+poer@inholland.nl'
  )
)
and membership.class_id <> (
  select class.id from public.classes class where class.code = 'LM1A'
);

insert into public.class_memberships (
  profile_id,
  class_id,
  membership_role,
  active
)
select
  profile.id,
  class.id,
  profile.profile_type::text::public.membership_role,
  true
from public.profiles profile
cross join public.classes class
where profile.email in (
    'jacco.borsch+student@inholland.nl',
    'jacco.borsch+buddy@inholland.nl',
    'jacco.borsch+poer@inholland.nl'
  )
  and class.code = 'LM1A'
on conflict (profile_id, class_id, membership_role) do update
set active = true,
    updated_at = now();

-- Alleen-lezen eindcontrole. Verwacht drie regels, allemaal actief op LM1A.
select
  profile.email,
  profile.profile_type as rol,
  class.code as klas,
  membership.active as klasrelatie_actief,
  (profile.auth_user_id is not null) as auth_gebruiker_gekoppeld
from public.profiles profile
join public.class_memberships membership on membership.profile_id = profile.id
join public.classes class on class.id = membership.class_id
where profile.email in (
  'jacco.borsch+student@inholland.nl',
  'jacco.borsch+buddy@inholland.nl',
  'jacco.borsch+poer@inholland.nl'
)
and membership.active = true
order by profile.profile_type;
