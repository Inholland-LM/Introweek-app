-- Toon organisatoren per gewijzigd veld de oude en nieuwe waarde.
-- De import- en mutatielogica blijven ongewijzigd; alleen de preview wordt verrijkt.

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

  select coalesce(jsonb_agg(
    change_item || jsonb_build_object(
      'previousValues',
      case
        when nullif(change_item->>'profileId', '') is null then null
        else (
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
          where profile.id = (change_item->>'profileId')::uuid
        )
      end
    )
  ), '[]'::jsonb)
  into enriched_changes
  from jsonb_array_elements(comparison->'changes') change_item;

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
  'Vergelijkt deelnemers veilig en toont organisatoren per mutatie de oude en nieuwe waarden.';
