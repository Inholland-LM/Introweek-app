-- Voorkom dat een e-mailadres in Personenbeheer wordt gewijzigd zonder dat
-- de gekoppelde Supabase Auth-identiteit mee verandert. Zo blijft inloggen
-- mogelijk en ontstaat er niet ongemerkt een tweede Auth-account.

create or replace function private.guard_linked_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_auth_email text;
begin
  if new.auth_user_id is null then
    return new;
  end if;

  select lower(btrim(auth_user.email))
  into linked_auth_email
  from auth.users auth_user
  where auth_user.id = new.auth_user_id;

  if linked_auth_email is null then
    raise exception 'De gekoppelde login bestaat niet meer. Neem contact op met de beheerder.'
      using errcode = '22023';
  end if;

  if lower(btrim(new.email)) <> linked_auth_email then
    raise exception 'Dit e-mailadres is ook de login van deze persoon. Wijzig een gekoppeld loginadres via Supabase Auth.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_linked_profile_email() from public, anon, authenticated;

drop trigger if exists guard_linked_profile_email on public.profiles;
create trigger guard_linked_profile_email
  before insert or update of email, auth_user_id on public.profiles
  for each row execute function private.guard_linked_profile_email();

comment on function private.guard_linked_profile_email() is
  'Houdt het profieladres en de gekoppelde Supabase Auth-login gelijk.';
