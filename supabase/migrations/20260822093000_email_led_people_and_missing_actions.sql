-- E-mail is de vaste identiteit voor ieder profiel. Een gewijzigd studentnummer
-- wordt daardoor een bevestigbare veldmutatie. Verwijderde profielen blijven
-- uitsluitend voor historie/audit bewaard en verdwijnen uit het personenbeheer.

alter table public.profiles
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles(id);

create index if not exists profiles_visible_people_idx
  on public.profiles (last_name, first_name)
  where removed_at is null;

create index if not exists profiles_removed_by_idx
  on public.profiles (removed_by)
  where removed_by is not null;

create or replace function public.preview_people_import_core(import_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.profile_type = 'organizer' and p.active = true and p.removed_at is null
  ) then
    raise exception 'Alleen een actieve organisator mag deelnemers vergelijken.' using errcode = '42501';
  end if;

  if import_rows is null or jsonb_typeof(import_rows) <> 'array'
    or jsonb_array_length(import_rows) = 0 or jsonb_array_length(import_rows) > 500 then
    raise exception 'De import moet tussen 1 en 500 personen bevatten.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(import_rows) item
    where jsonb_typeof(item) <> 'object'
       or nullif(btrim(item->>'firstName'), '') is null
       or nullif(btrim(item->>'lastName'), '') is null
       or nullif(btrim(item->>'email'), '') is null
       or position('@' in coalesce(item->>'email', '')) < 2
       or length(coalesce(item->>'studentNumber', '')) > 50
       or length(coalesce(item->>'firstName', '')) > 100
       or length(coalesce(item->>'namePrefix', '')) > 50
       or length(coalesce(item->>'lastName', '')) > 100
       or length(coalesce(item->>'email', '')) > 320
       or length(coalesce(item->>'classCode', '')) > 10
       or coalesce(item->>'role', '') not in ('student', 'buddy', 'poer', 'interested_teacher', 'organizer')
       or coalesce(jsonb_typeof(item->'active'), 'null') <> 'boolean'
       or ((item->>'role') in ('student', 'buddy') and nullif(btrim(item->>'studentNumber'), '') is null)
       or ((item->>'role') in ('student', 'buddy', 'poer') and nullif(btrim(item->>'classCode'), '') is null)
  ) then
    raise exception 'De import bevat onvolledige of ongeldige personen.' using errcode = '22023';
  end if;

  if exists (
    select 1 from (
      select lower(btrim(item->>'email')) from jsonb_array_elements(import_rows) item
      group by lower(btrim(item->>'email')) having count(*) > 1
    ) duplicate_email
  ) or exists (
    select 1 from (
      select btrim(item->>'studentNumber') from jsonb_array_elements(import_rows) item
      where nullif(btrim(item->>'studentNumber'), '') is not null
      group by btrim(item->>'studentNumber') having count(*) > 1
    ) duplicate_number
  ) then
    raise exception 'De import bevat dubbele e-mailadressen of studentnummers.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(import_rows) item
    where nullif(btrim(item->>'classCode'), '') is not null
      and not exists (
        select 1 from public.classes c
        where c.code = upper(btrim(item->>'classCode')) and c.active = true
      )
  ) then
    raise exception 'De import bevat een onbekende of inactieve klas.' using errcode = '22023';
  end if;

  with incoming as materialized (
    select ordinality::integer + 1 as row_number,
      nullif(btrim(item->>'studentNumber'), '') as student_number,
      btrim(item->>'firstName') as first_name,
      nullif(btrim(item->>'namePrefix'), '') as name_prefix,
      btrim(item->>'lastName') as last_name,
      lower(btrim(item->>'email')) as email,
      item->>'role' as profile_type,
      nullif(upper(btrim(item->>'classCode')), '') as class_code,
      (item->>'active')::boolean as active
    from jsonb_array_elements(import_rows) with ordinality source(item, ordinality)
  ), current_people as materialized (
    select p.id, p.student_number, p.first_name, p.name_prefix, p.last_name,
      p.email, p.profile_type::text as profile_type, p.active, p.removed_at,
      membership.class_code
    from public.profiles p
    left join lateral (
      select c.code as class_code from public.class_memberships cm
      join public.classes c on c.id = cm.class_id
      where cm.profile_id = p.id and cm.active = true
      order by cm.updated_at desc, cm.created_at desc limit 1
    ) membership on true
  ), matched as (
    select i.*,
      p.id as current_id, p.student_number as current_student_number,
      p.first_name as current_first_name, p.name_prefix as current_name_prefix,
      p.last_name as current_last_name, p.email as current_email,
      p.profile_type as current_profile_type, p.class_code as current_class_code,
      p.active as current_active, p.removed_at as current_removed_at,
      number_owner.id as conflicting_number_owner_id
    from incoming i
    left join current_people p on p.email = i.email
    left join current_people number_owner
      on i.student_number is not null
     and number_owner.student_number = i.student_number
     and number_owner.id is distinct from p.id
  ), classified as (
    select m.*,
      case
        when m.current_id is not null and m.current_profile_type <> m.profile_type then 'conflict'
        when m.conflicting_number_owner_id is not null then 'conflict'
        when m.current_id is null then 'new'
        when m.current_student_number is distinct from m.student_number
          or m.current_first_name is distinct from m.first_name
          or m.current_name_prefix is distinct from m.name_prefix
          or m.current_last_name is distinct from m.last_name
          or m.current_class_code is distinct from m.class_code
          or m.current_active is distinct from m.active
          or m.current_removed_at is not null then 'changed'
        else 'unchanged'
      end as status,
      array_remove(array[
        case when m.current_student_number is distinct from m.student_number then 'studentnummer' end,
        case when m.current_first_name is distinct from m.first_name then 'voornaam' end,
        case when m.current_name_prefix is distinct from m.name_prefix then 'tussenvoegsel' end,
        case when m.current_last_name is distinct from m.last_name then 'achternaam' end,
        case when m.current_profile_type is distinct from m.profile_type then 'rol' end,
        case when m.current_class_code is distinct from m.class_code then 'klas' end,
        case when m.current_active is distinct from m.active or m.current_removed_at is not null then 'actief' end
      ], null)::text[] as changed_fields
    from matched m
  ), deactivated as (
    select p.* from current_people p
    where p.removed_at is null
      and not exists (select 1 from incoming i where i.email = p.email)
  )
  select jsonb_build_object(
    'totalIncoming', (select count(*) from incoming),
    'new', (select count(*) from classified where status = 'new'),
    'changed', (select count(*) from classified where status = 'changed'),
    'unchanged', (select count(*) from classified where status = 'unchanged'),
    'conflicts', (select count(*) from classified where status = 'conflict'),
    'deactivated', (select count(*) from deactivated),
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
      'row', c.row_number, 'status', c.status, 'profileId', c.current_id,
      'displayName', concat_ws(' ', c.first_name, c.name_prefix, c.last_name),
      'identifier', coalesce(c.student_number, c.email), 'classCode', c.class_code,
      'fields', to_jsonb(c.changed_fields)
    ) order by c.row_number) from classified c where c.status <> 'unchanged'), '[]'::jsonb),
    'deactivations', coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', d.id, 'status', 'deactivated',
      'displayName', concat_ws(' ', d.first_name, d.name_prefix, d.last_name),
      'identifier', coalesce(d.student_number, d.email), 'classCode', d.class_code,
      'fields', jsonb_build_array('actief')
    ) order by d.last_name, d.first_name) from deactivated d), '[]'::jsonb),
    'generatedAt', now()
  ) into result;
  return result;
end;
$$;

create or replace function public.preview_people_import(import_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare comparison jsonb; enriched_changes jsonb; enriched_deactivations jsonb;
begin
  lock table public.profiles, public.class_memberships, public.classes in share mode;
  comparison := public.preview_people_import_core(import_rows);

  with change_rows as (
    select change_item, ordinality,
      coalesce(nullif(change_item->>'profileId', '')::uuid, (
        select owner.id from public.profiles owner
        where owner.student_number = nullif(btrim((import_rows -> ((change_item->>'row')::integer - 2))->>'studentNumber'), '')
        order by owner.active desc, owner.updated_at desc limit 1
      )) as resolved_profile_id
    from jsonb_array_elements(comparison->'changes') with ordinality source(change_item, ordinality)
  ), enriched as (
    select cr.*, p.student_number, p.first_name, p.name_prefix, p.last_name,
      p.email, p.profile_type::text as profile_type, p.active, membership.class_code
    from change_rows cr left join public.profiles p on p.id = cr.resolved_profile_id
    left join lateral (
      select c.code as class_code from public.class_memberships cm join public.classes c on c.id = cm.class_id
      where cm.profile_id = p.id and cm.active = true
      order by cm.updated_at desc, cm.created_at desc limit 1
    ) membership on true
  ) select coalesce(jsonb_agg(change_item || jsonb_build_object(
      'previousValues', case when resolved_profile_id is null then null else jsonb_build_object(
        'studentNumber', student_number, 'firstName', first_name, 'namePrefix', name_prefix,
        'lastName', last_name, 'email', email, 'role', profile_type,
        'classCode', class_code, 'active', active) end,
      'conflictReason', case
        when change_item->>'status' <> 'conflict' then null
        when nullif(change_item->>'profileId', '') is null then 'student_number_in_use'
        else 'role_mismatch'
      end,
      'conflictingIdentifier', case when change_item->>'status' = 'conflict' then coalesce(student_number, email) else null end
    ) order by ordinality), '[]'::jsonb) into enriched_changes from enriched;

  select coalesce(jsonb_agg(deactivation_item || jsonb_build_object('previousValues', (
    select jsonb_build_object(
      'studentNumber', p.student_number, 'firstName', p.first_name, 'namePrefix', p.name_prefix,
      'lastName', p.last_name, 'email', p.email, 'role', p.profile_type::text,
      'classCode', membership.class_code, 'active', p.active)
    from public.profiles p left join lateral (
      select c.code as class_code from public.class_memberships cm join public.classes c on c.id = cm.class_id
      where cm.profile_id = p.id and cm.active = true
      order by cm.updated_at desc, cm.created_at desc limit 1
    ) membership on true where p.id = (deactivation_item->>'profileId')::uuid
  ))), '[]'::jsonb) into enriched_deactivations
  from jsonb_array_elements(comparison->'deactivations') deactivation_item;

  comparison := jsonb_set(comparison, '{changes}', enriched_changes, true);
  comparison := jsonb_set(comparison, '{deactivations}', enriched_deactivations, true);
  return comparison || jsonb_build_object('stateVersion', private.people_data_version());
end;
$$;

do $$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('public.apply_people_import(jsonb,text)'::regprocedure);
  patched := replace(definition,
    '  v_is_active boolean;' || chr(13) || chr(10) || '  v_display_name text;',
    '  v_is_active boolean;' || chr(13) || chr(10) || '  v_remove_from_app boolean;' || chr(13) || chr(10) || '  v_display_name text;');
  patched := replace(patched,
    '    v_is_active := (item->>''active'')::boolean;' || chr(13) || chr(10) || '    v_display_name :=',
    '    v_is_active := (item->>''active'')::boolean;' || chr(13) || chr(10) || '    v_remove_from_app := coalesce((item->>''removeFromApp'')::boolean, false);' || chr(13) || chr(10) || '    v_display_name :=');
  patched := replace(patched,
    '    if v_profile_role in (''student'', ''buddy'') then' || chr(13) || chr(10) ||
    '      select p.id into v_profile_id' || chr(13) || chr(10) || '      from public.profiles p' || chr(13) || chr(10) ||
    '      where p.student_number = v_student_number;' || chr(13) || chr(10) || '    else' || chr(13) || chr(10) ||
    '      select p.id into v_profile_id' || chr(13) || chr(10) || '      from public.profiles p' || chr(13) || chr(10) ||
    '      where p.email = v_email_address;' || chr(13) || chr(10) || '    end if;',
    '    select p.id into v_profile_id' || chr(13) || chr(10) || '    from public.profiles p' || chr(13) || chr(10) ||
    '    where p.email = v_email_address;');
  patched := replace(patched,
    '          active = v_is_active,' || chr(13) || chr(10) || '          updated_at = now()',
    '          active = v_is_active,' || chr(13) || chr(10) ||
    '          removed_at = case when v_remove_from_app then now() else null end,' || chr(13) || chr(10) ||
    '          removed_by = case when v_remove_from_app then caller_profile_id else null end,' || chr(13) || chr(10) ||
    '          updated_at = now()');
  patched := replace(patched,
    '          or active is distinct from v_is_active' || chr(13) || chr(10) || '        );',
    '          or active is distinct from v_is_active' || chr(13) || chr(10) ||
    '          or (removed_at is not null) is distinct from v_remove_from_app' || chr(13) || chr(10) || '        );');
  patched := replace(patched,
    '        profile_type,' || chr(13) || chr(10) || '        active' || chr(13) || chr(10) || '      ) values (',
    '        profile_type,' || chr(13) || chr(10) || '        active,' || chr(13) || chr(10) || '        removed_at,' || chr(13) || chr(10) || '        removed_by' || chr(13) || chr(10) || '      ) values (');
  patched := replace(patched,
    '        v_profile_role,' || chr(13) || chr(10) || '        v_is_active' || chr(13) || chr(10) || '      ) returning id into v_profile_id;',
    '        v_profile_role,' || chr(13) || chr(10) || '        v_is_active,' || chr(13) || chr(10) ||
    '        case when v_remove_from_app then now() else null end,' || chr(13) || chr(10) ||
    '        case when v_remove_from_app then caller_profile_id else null end' || chr(13) || chr(10) || '      ) returning id into v_profile_id;');
  patched := replace(patched,
    '        where (p.profile_type in (''student'', ''buddy'') and btrim(imported_item->>''studentNumber'') = p.student_number)' || chr(13) || chr(10) ||
    '           or (p.profile_type in (''poer'', ''interested_teacher'', ''organizer'') and lower(btrim(imported_item->>''email'')) = p.email)',
    '        where lower(btrim(imported_item->>''email'')) = p.email');
  if patched = definition then raise exception 'apply_people_import kon niet veilig worden bijgewerkt.'; end if;
  execute patched;
end $$;

create or replace function private.people_data_version()
returns text language sql security definer set search_path = '' as $$
  select md5(coalesce((select jsonb_agg(jsonb_build_array(
    p.id, p.student_number, p.first_name, p.name_prefix, p.last_name, p.email,
    p.profile_type, p.active, p.removed_at, p.updated_at) order by p.id)::text
    from public.profiles p), '[]') || '|' ||
    coalesce((select jsonb_agg(jsonb_build_array(cm.id, cm.profile_id, cm.class_id,
      cm.membership_role, cm.active, cm.updated_at) order by cm.id)::text
      from public.class_memberships cm), '[]') || '|' ||
    coalesce((select jsonb_agg(jsonb_build_array(c.id, c.code, c.active, c.updated_at)
      order by c.id)::text from public.classes c), '[]'));
$$;

create or replace function public.get_organizer_people()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.profiles organizer
    where organizer.auth_user_id = (select auth.uid())
      and organizer.active = true
      and organizer.removed_at is null
      and organizer.profile_type = 'organizer'
  ) then
    raise exception 'Alleen een actieve organisator mag personen bekijken.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profileId', source.id, 'studentNumber', source.student_number,
    'firstName', source.first_name, 'namePrefix', source.name_prefix,
    'lastName', source.last_name, 'email', source.email,
    'role', source.profile_type, 'classCode', source.class_code,
    'active', source.active
  ) order by source.last_name, source.name_prefix, source.first_name, source.email), '[]'::jsonb)
  into result
  from (
    select distinct on (profile.id)
      profile.id, profile.student_number, profile.first_name, profile.name_prefix,
      profile.last_name, profile.email, profile.profile_type::text as profile_type,
      class.code as class_code, profile.active
    from public.profiles profile
    left join public.class_memberships membership on membership.profile_id = profile.id
    left join public.classes class on class.id = membership.class_id
    where profile.removed_at is null
    order by profile.id, membership.active desc, membership.updated_at desc nulls last,
      membership.created_at desc nulls last
  ) source;
  return result;
end;
$$;

revoke all on function public.preview_people_import_core(jsonb) from public, anon, authenticated;
revoke all on function public.preview_people_import(jsonb) from public, anon;
grant execute on function public.preview_people_import(jsonb) to authenticated;

comment on column public.profiles.removed_at is
  'Veilige verwijdering uit de actuele app; het profiel blijft bestaan voor historie en audit.';
comment on function public.preview_people_import(jsonb) is
  'Vergelijkt personen op e-mailadres; studentnummerwijzigingen worden expliciet ter bevestiging getoond.';
