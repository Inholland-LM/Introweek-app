-- Geef organisatoren bij een geblokkeerde personenimport de concrete botsing.
-- De herkenningsregels blijven ongewijzigd: studentnummer is de vaste sleutel
-- voor student/buddy; e-mail is de vaste sleutel voor de overige rollen.

create or replace function public.preview_people_import(import_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comparison jsonb;
  enriched_changes jsonb;
  enriched_deactivations jsonb;
begin
  lock table public.profiles, public.class_memberships, public.classes
    in share mode;

  comparison := public.preview_people_import_core(import_rows);

  with change_rows as (
    select
      change_item,
      ordinality,
      case
        when nullif(change_item->>'profileId', '') is not null
          then (change_item->>'profileId')::uuid
        when change_item->>'status' = 'conflict'
          then (
            select profile.id
            from public.profiles profile
            where lower(profile.email) = lower(btrim(
              (import_rows -> ((change_item->>'row')::integer - 2))->>'email'
            ))
            order by profile.active desc, profile.updated_at desc
            limit 1
          )
        else null
      end as resolved_profile_id
    from jsonb_array_elements(comparison->'changes') with ordinality source(change_item, ordinality)
  ),
  enriched as (
    select
      change_row.*,
      profile.student_number,
      profile.first_name,
      profile.name_prefix,
      profile.last_name,
      profile.email,
      profile.profile_type::text as profile_type,
      profile.active,
      membership.class_code
    from change_rows change_row
    left join public.profiles profile on profile.id = change_row.resolved_profile_id
    left join lateral (
      select class.code as class_code
      from public.class_memberships class_membership
      join public.classes class on class.id = class_membership.class_id
      where class_membership.profile_id = profile.id
        and class_membership.active = true
      order by class_membership.updated_at desc, class_membership.created_at desc
      limit 1
    ) membership on true
  )
  select coalesce(jsonb_agg(
    change_item || jsonb_build_object(
      'previousValues',
      case
        when resolved_profile_id is null then null
        else jsonb_build_object(
          'firstName', first_name,
          'namePrefix', name_prefix,
          'lastName', last_name,
          'email', email,
          'role', profile_type,
          'classCode', class_code,
          'active', active
        )
      end,
      'conflictReason',
      case
        when change_item->>'status' <> 'conflict' then null
        when nullif(change_item->>'profileId', '') is null then 'email_in_use'
        else 'role_mismatch'
      end,
      'conflictingIdentifier',
      case
        when change_item->>'status' = 'conflict' then coalesce(student_number, email)
        else null
      end
    ) order by ordinality
  ), '[]'::jsonb)
  into enriched_changes
  from enriched;

  select coalesce(jsonb_agg(
    deactivation_item || jsonb_build_object(
      'previousValues',
      (
        select jsonb_build_object(
          'firstName', profile.first_name,
          'namePrefix', profile.name_prefix,
          'lastName', profile.last_name,
          'email', profile.email,
          'role', profile.profile_type::text,
          'classCode', membership.class_code,
          'active', profile.active
        )
        from public.profiles profile
        left join lateral (
          select class.code as class_code
          from public.class_memberships class_membership
          join public.classes class on class.id = class_membership.class_id
          where class_membership.profile_id = profile.id
            and class_membership.active = true
          order by class_membership.updated_at desc, class_membership.created_at desc
          limit 1
        ) membership on true
        where profile.id = (deactivation_item->>'profileId')::uuid
      )
    )
  ), '[]'::jsonb)
  into enriched_deactivations
  from jsonb_array_elements(comparison->'deactivations') deactivation_item;

  comparison := jsonb_set(comparison, '{changes}', enriched_changes, true);
  comparison := jsonb_set(comparison, '{deactivations}', enriched_deactivations, true);

  return comparison || jsonb_build_object('stateVersion', private.people_data_version());
end;
$$;

revoke all on function public.preview_people_import(jsonb) from public, anon;
grant execute on function public.preview_people_import(jsonb) to authenticated;

comment on function public.preview_people_import(jsonb) is
  'Vergelijkt deelnemers en legt bij een sleutelconflict de bestaande eigenaar en herstelactie uit.';
