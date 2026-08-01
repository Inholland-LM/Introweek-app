-- Introweek-app: veilige, alleen-lezen voorvertoning van een deelnemersimport.
-- Het Excelbestand blijft in de browser; alleen genormaliseerde rijen bereiken deze functie.

create or replace function public.preview_people_import(import_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.profile_type = 'organizer'
      and p.active = true
  ) then
    raise exception 'Alleen een actieve organisator mag deelnemers vergelijken.'
      using errcode = '42501';
  end if;

  if import_rows is null or jsonb_typeof(import_rows) <> 'array' then
    raise exception 'De import moet een JSON-lijst zijn.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(import_rows) = 0 or jsonb_array_length(import_rows) > 500 then
    raise exception 'De import moet tussen 1 en 500 personen bevatten.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(import_rows) item
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
       or coalesce(item->>'role', '') not in ('student', 'buddy', 'poer', 'organizer')
       or coalesce(jsonb_typeof(item->'active'), 'null') <> 'boolean'
       or ((item->>'role') in ('student', 'buddy') and nullif(btrim(item->>'studentNumber'), '') is null)
       or ((item->>'role') <> 'organizer' and nullif(btrim(item->>'classCode'), '') is null)
  ) then
    raise exception 'De import bevat onvolledige of ongeldige personen.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(item->>'email')) as import_key
      from jsonb_array_elements(import_rows) item
      group by lower(btrim(item->>'email'))
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from (
      select btrim(item->>'studentNumber') as import_key
      from jsonb_array_elements(import_rows) item
      where nullif(btrim(item->>'studentNumber'), '') is not null
      group by btrim(item->>'studentNumber')
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'De import bevat dubbele e-mailadressen of studentnummers.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(import_rows) item
    where nullif(btrim(item->>'classCode'), '') is not null
      and not exists (
        select 1
        from public.classes c
        where c.code = upper(btrim(item->>'classCode'))
          and c.active = true
      )
  ) then
    raise exception 'De import bevat een onbekende of inactieve klas.'
      using errcode = '22023';
  end if;

  with incoming as materialized (
    select
      ordinality::integer + 1 as row_number,
      nullif(btrim(item->>'studentNumber'), '') as student_number,
      btrim(item->>'firstName') as first_name,
      nullif(btrim(item->>'namePrefix'), '') as name_prefix,
      btrim(item->>'lastName') as last_name,
      lower(btrim(item->>'email')) as email,
      item->>'role' as profile_type,
      nullif(upper(btrim(item->>'classCode')), '') as class_code,
      (item->>'active')::boolean as active
    from jsonb_array_elements(import_rows) with ordinality source(item, ordinality)
  ),
  current_people as materialized (
    select
      p.id,
      p.student_number,
      p.first_name,
      p.name_prefix,
      p.last_name,
      p.email,
      p.profile_type::text as profile_type,
      p.active,
      membership.class_code
    from public.profiles p
    left join lateral (
      select c.code as class_code
      from public.class_memberships cm
      join public.classes c on c.id = cm.class_id
      where cm.profile_id = p.id
        and cm.active = true
      order by cm.updated_at desc, cm.created_at desc
      limit 1
    ) membership on true
  ),
  matched as (
    select
      i.*,
      p.id as current_id,
      p.student_number as current_student_number,
      p.first_name as current_first_name,
      p.name_prefix as current_name_prefix,
      p.last_name as current_last_name,
      p.email as current_email,
      p.profile_type as current_profile_type,
      p.class_code as current_class_code,
      p.active as current_active,
      email_owner.id as conflicting_email_owner_id
    from incoming i
    left join current_people p on (
      (i.profile_type in ('student', 'buddy') and p.student_number = i.student_number)
      or (i.profile_type in ('poer', 'organizer') and p.email = i.email)
    )
    left join current_people email_owner
      on email_owner.email = i.email
     and email_owner.id is distinct from p.id
  ),
  classified as (
    select
      m.*,
      case
        when m.current_id is not null and m.current_profile_type <> m.profile_type then 'conflict'
        when m.conflicting_email_owner_id is not null then 'conflict'
        when m.current_id is null then 'new'
        when m.current_first_name is distinct from m.first_name
          or m.current_name_prefix is distinct from m.name_prefix
          or m.current_last_name is distinct from m.last_name
          or m.current_email is distinct from m.email
          or m.current_class_code is distinct from m.class_code
          or m.current_active is distinct from m.active then 'changed'
        else 'unchanged'
      end as status,
      array_remove(array[
        case when m.current_first_name is distinct from m.first_name then 'voornaam' end,
        case when m.current_name_prefix is distinct from m.name_prefix then 'tussenvoegsel' end,
        case when m.current_last_name is distinct from m.last_name then 'achternaam' end,
        case when m.current_email is distinct from m.email then 'e-mailadres' end,
        case when m.current_profile_type is distinct from m.profile_type then 'rol' end,
        case when m.current_class_code is distinct from m.class_code then 'klas' end,
        case when m.current_active is distinct from m.active then 'actief' end
      ], null)::text[] as changed_fields
    from matched m
  ),
  deactivated as (
    select p.*
    from current_people p
    where p.active = true
      and not exists (
        select 1
        from incoming i
        where (p.profile_type in ('student', 'buddy') and i.student_number = p.student_number)
           or (p.profile_type in ('poer', 'organizer') and i.email = p.email)
      )
  )
  select jsonb_build_object(
    'totalIncoming', (select count(*) from incoming),
    'new', (select count(*) from classified where status = 'new'),
    'changed', (select count(*) from classified where status = 'changed'),
    'unchanged', (select count(*) from classified where status = 'unchanged'),
    'conflicts', (select count(*) from classified where status = 'conflict'),
    'deactivated', (select count(*) from deactivated),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'row', c.row_number,
        'status', c.status,
        'profileId', c.current_id,
        'displayName', concat_ws(' ', c.first_name, c.name_prefix, c.last_name),
        'identifier', coalesce(c.student_number, c.email),
        'classCode', c.class_code,
        'fields', to_jsonb(c.changed_fields)
      ) order by c.row_number)
      from classified c
      where c.status <> 'unchanged'
    ), '[]'::jsonb),
    'deactivations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profileId', d.id,
        'status', 'deactivated',
        'displayName', concat_ws(' ', d.first_name, d.name_prefix, d.last_name),
        'identifier', coalesce(d.student_number, d.email),
        'classCode', d.class_code,
        'fields', jsonb_build_array('actief')
      ) order by d.last_name, d.first_name)
      from deactivated d
    ), '[]'::jsonb),
    'generatedAt', now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.preview_people_import(jsonb) from public, anon;
grant execute on function public.preview_people_import(jsonb) to authenticated;

comment on function public.preview_people_import(jsonb) is
  'Vergelijkt een lokaal gevalideerde deelnemersimport met de actuele database zonder gegevens te wijzigen.';
