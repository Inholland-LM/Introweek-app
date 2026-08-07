-- Introweek-app: geef een ingelogde deelnemer uitsluitend de contactpersonen
-- van de eigen actieve klas. Er worden geen brede leesrechten op profielen
-- of klasrelaties toegevoegd.

create or replace function public.get_my_class_contacts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_profile_id uuid;
  own_class_id uuid;
  contacts jsonb;
begin
  select p.id
  into own_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
  limit 1;

  if own_profile_id is null then
    raise exception 'Er is geen actief profiel aan deze gebruiker gekoppeld.'
      using errcode = '42501';
  end if;

  select cm.class_id
  into own_class_id
  from public.class_memberships cm
  where cm.profile_id = own_profile_id
    and cm.active = true
  order by cm.updated_at desc, cm.created_at desc
  limit 1;

  if own_class_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', contact_profile.id,
        'displayName', concat_ws(' ', contact_profile.first_name, contact_profile.name_prefix, contact_profile.last_name),
        'email', contact_profile.email,
        'role', contact_profile.profile_type
      )
      order by
        case contact_profile.profile_type when 'poer' then 0 else 1 end,
        contact_profile.last_name,
        contact_profile.first_name
    ),
    '[]'::jsonb
  )
  into contacts
  from public.class_memberships contact_membership
  join public.profiles contact_profile
    on contact_profile.id = contact_membership.profile_id
  where contact_membership.class_id = own_class_id
    and contact_membership.active = true
    and contact_profile.active = true
    and contact_profile.profile_type in ('buddy', 'poer')
    and contact_profile.id <> own_profile_id;

  return contacts;
end;
$$;

revoke all on function public.get_my_class_contacts() from public, anon;
grant execute on function public.get_my_class_contacts() to authenticated;

comment on function public.get_my_class_contacts() is
  'Geeft uitsluitend de actieve buddies en POer van de eigen actieve klas terug.';
