-- Toon actieve en inactieve personen in het OD en laat een organisator de
-- profielstatus veilig wijzigen zonder profiel-, klas- of historiegegevens te verwijderen.

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
  ) order by source.last_name, source.name_prefix, source.first_name, source.email), '[]'::jsonb)
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
    left join public.classes class
      on class.id = membership.class_id
    order by
      profile.id,
      membership.active desc,
      membership.updated_at desc nulls last,
      membership.created_at desc nulls last
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
  person_class_code text,
  person_active boolean
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
  desired_active boolean := coalesce(person_active, true);
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

  if target_profile_id = organizer_profile_id
    and (normalized_role <> 'organizer' or desired_active = false)
  then
    raise exception 'Je kunt je eigen actieve organisatorprofiel niet uitschakelen.' using errcode = '42501';
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
      desired_active
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
        active = desired_active,
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
      desired_active,
      now()
    )
    on conflict (profile_id, class_id, membership_role)
    do update set active = desired_active, updated_at = now();
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

-- Houd de bestaande acht-parameter-aanroep bruikbaar voor oudere, nog gecachete clients.
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
language sql
security definer
set search_path = ''
as $$
  select public.save_organizer_person(
    target_profile_id,
    person_student_number,
    person_first_name,
    person_name_prefix,
    person_last_name,
    person_email,
    person_role,
    person_class_code,
    true
  );
$$;

revoke all on function public.save_organizer_person(uuid, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.save_organizer_person(uuid, text, text, text, text, text, text, text, boolean) to authenticated;

comment on function public.get_organizer_people() is
  'Geeft uitsluitend aan een actieve organisator alle actieve en inactieve OD-profielen met hun laatst bekende klas.';
comment on function public.save_organizer_person(uuid, text, text, text, text, text, text, text, boolean) is
  'Voegt of wijzigt één persoon, profielstatus en klasrelatie na expliciete organisatorcontrole.';
