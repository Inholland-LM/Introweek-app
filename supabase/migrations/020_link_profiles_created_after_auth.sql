-- Koppel ook profielen die pas na de eerste Auth-aanmelding worden aangemaakt.
-- De bestaande Auth-trigger dekt de omgekeerde volgorde al af.

create or replace function private.guard_linked_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_auth_email text;
  matching_auth_user_id uuid;
begin
  if new.auth_user_id is null and new.active then
    select auth_user.id
    into matching_auth_user_id
    from auth.users auth_user
    where lower(btrim(auth_user.email)) = lower(btrim(new.email))
    order by auth_user.created_at asc
    limit 1;

    if matching_auth_user_id is not null then
      new.auth_user_id := matching_auth_user_id;
    end if;
  end if;

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

-- Herstel bestaande actieve profielen waarvoor de Auth-gebruiker eerder is
-- aangemaakt dan het profiel. De trigger voert de exacte e-mailcontrole uit.
update public.profiles profile
set auth_user_id = null
where profile.active = true
  and profile.auth_user_id is null
  and exists (
    select 1
    from auth.users auth_user
    where lower(btrim(auth_user.email)) = profile.email
  );

comment on function private.guard_linked_profile_email() is
  'Houdt profiel- en Auth-adres gelijk en koppelt veilig ongeacht de aanmaakvolgorde.';
