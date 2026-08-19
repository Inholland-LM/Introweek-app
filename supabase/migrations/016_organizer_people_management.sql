-- Koppel Personen & Rollen in het organisatiedashboard aan dezelfde profielen
-- en klasrelaties die door de Excel-import worden beheerd.

create or replace function public.get_organizer_people()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.profiles organizer
    where organizer.auth_user_id = (select auth.uid())
      and organizer.active = true
      and organizer.profile_type = 'organizer'
  ) then
    raise exception 'Alleen een actieve organisator mag personen bekijken.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profileId', source.id,
    'studentNumber', source.student_number,
    'firstName', source.first_name,
    'namePrefix', source.name_prefix,
    'lastName', source.last_name,
    'email', source.email,
    'role', source.profile_type,
    'classCode', source.class_code,
    'active', source.active
  ) order by source.last_name, source.first_name, source.email), '[]'::jsonb)
  into result
  from (
    select distinct on (profile.id)
      profile.id,
      profile.student_number,
      profile.first_name,
      profile.name_prefix,
      profile.last_name,
      profile.email,
      profile.profile_type::text as profile_type,
      class.code as class_code,
      profile.active
    from public.profiles profile
    left join public.class_memberships membership
      on membership.profile_id = profile.id
     and membership.active = true
    left join public.classes class
      on class.id = membership.class_id
     and class.active = true
    where profile.active = true
    order by profile.id, membership.updated_at desc nulls last
  ) source;

  return result;
end;
$$;

create or replace function public.save_organizer_person(
  target_profile_id uuid,
  person_student_number text,
  person_first_name text,
  person_name_prefix text,
  person_last_name text,
  person_email text,
  person_role text,
  person_class_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
  saved_profile_id uuid;
  normalized_role public.profile_type;
  normalized_email text := lower(btrim(person_email));
  normalized_student_number text := nullif(btrim(person_student_number), '');
  normalized_class_code text := nullif(upper(btrim(person_class_code)), '');
  selected_class_id uuid;
begin
  select profile.id
  into organizer_profile_id
  from public.profiles profile
  where profile.auth_user_id = (select auth.uid())
    and profile.active = true
    and profile.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag personen beheren.' using errcode = '42501';
  end if;

  begin
    normalized_role := person_role::public.profile_type;
  exception when invalid_text_representation then
    raise exception 'De gekozen rol is ongeldig.' using errcode = '22023';
  end;

  if nullif(btrim(person_first_name), '') is null
    or nullif(btrim(person_last_name), '') is null
    or normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Voornaam, achternaam en een geldig e-mailadres zijn verplicht.' using errcode = '22023';
  end if;

  if normalized_role in ('student', 'buddy') and normalized_student_number is null then
    raise exception 'Voor studenten en buddy''s is een studentnummer verplicht.' using errcode = '22023';
  end if;

  if normalized_role in ('student', 'buddy', 'poer') and normalized_class_code is null then
    raise exception 'Voor studenten, buddy''s en PO''ers is een klas verplicht.' using errcode = '22023';
  end if;

  if normalized_class_code is not null then
    select class.id
    into selected_class_id
    from public.classes class
    where class.code = normalized_class_code
      and class.active = true
    limit 1;
    if selected_class_id is null then
      raise exception 'De gekozen klas bestaat niet of is niet actief.' using errcode = '22023';
    end if;
  end if;

  if target_profile_id = organizer_profile_id and normalized_role <> 'organizer' then
    raise exception 'Je kunt je eigen actieve organisatorrol niet verwijderen.' using errcode = '42501';
  end if;

  if target_profile_id is null then
    insert into public.profiles (
      email, student_number, first_name, name_prefix, last_name, profile_type, active
    ) values (
      normalized_email,
      normalized_student_number,
      btrim(person_first_name),
      nullif(btrim(person_name_prefix), ''),
      btrim(person_last_name),
      normalized_role,
      true
    )
    returning id into saved_profile_id;
  else
    update public.profiles profile
    set email = normalized_email,
        student_number = normalized_student_number,
        first_name = btrim(person_first_name),
        name_prefix = nullif(btrim(person_name_prefix), ''),
        last_name = btrim(person_last_name),
        profile_type = normalized_role,
        active = true,
        updated_at = now()
    where profile.id = target_profile_id
    returning profile.id into saved_profile_id;

    if saved_profile_id is null then
      raise exception 'Het profiel bestaat niet meer.' using errcode = '22023';
    end if;
  end if;

  update public.class_memberships membership
  set active = false,
      updated_at = now()
  where membership.profile_id = saved_profile_id
    and membership.active = true;

  if normalized_role in ('student', 'buddy', 'poer') then
    insert into public.class_memberships (
      profile_id, class_id, membership_role, active, updated_at
    ) values (
      saved_profile_id,
      selected_class_id,
      normalized_role::text::public.membership_role,
      true,
      now()
    )
    on conflict (profile_id, class_id, membership_role)
    do update set active = true, updated_at = now();
  end if;

  return (
    select jsonb_build_object(
      'profileId', profile.id,
      'studentNumber', profile.student_number,
      'firstName', profile.first_name,
      'namePrefix', profile.name_prefix,
      'lastName', profile.last_name,
      'email', profile.email,
      'role', profile.profile_type::text,
      'classCode', normalized_class_code,
      'active', profile.active
    )
    from public.profiles profile
    where profile.id = saved_profile_id
  );
end;
$$;

create or replace function public.deactivate_organizer_person(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
begin
  select profile.id
  into organizer_profile_id
  from public.profiles profile
  where profile.auth_user_id = (select auth.uid())
    and profile.active = true
    and profile.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag personen beheren.' using errcode = '42501';
  end if;
  if target_profile_id = organizer_profile_id then
    raise exception 'Je kunt je eigen actieve organisatorprofiel niet verwijderen.' using errcode = '42501';
  end if;

  update public.profiles profile
  set active = false,
      updated_at = now()
  where profile.id = target_profile_id
    and profile.active = true;

  if not found then
    raise exception 'Het profiel bestaat niet meer of is al verwijderd.' using errcode = '22023';
  end if;

  update public.class_memberships membership
  set active = false,
      updated_at = now()
  where membership.profile_id = target_profile_id
    and membership.active = true;
end;
$$;

revoke all on function public.get_organizer_people() from public, anon, authenticated;
revoke all on function public.save_organizer_person(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.deactivate_organizer_person(uuid) from public, anon, authenticated;

grant execute on function public.get_organizer_people() to authenticated;
grant execute on function public.save_organizer_person(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.deactivate_organizer_person(uuid) to authenticated;

comment on function public.get_organizer_people() is
  'Geeft uitsluitend aan een actieve organisator de actuele OD-personenlijst.';
comment on function public.save_organizer_person(uuid, text, text, text, text, text, text, text) is
  'Voegt of wijzigt één persoon en diens actieve klasrelatie na expliciete organisatorcontrole.';
comment on function public.deactivate_organizer_person(uuid) is
  'Deactiveert één profiel en diens klasrelaties; het eigen organisatorprofiel is beschermd.';
