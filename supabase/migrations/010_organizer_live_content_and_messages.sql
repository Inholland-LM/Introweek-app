-- Veilige live-updates vanuit het organisatiedashboard.
-- De algemene inhoud blijft één versiegestuurde snapshot; persoonlijke
-- berichten worden per ontvanger opgeslagen en door bestaande RLS afgeschermd.

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('welcome', 'class_changed', 'class_member_arrived', 'class_member_left', 'broadcast'));

alter table public.notifications
  add column if not exists delivery_channel text not null default 'in-app',
  add column if not exists action_target text not null default 'notifications';

alter table public.notifications
  drop constraint if exists notifications_delivery_channel_check;
alter table public.notifications
  add constraint notifications_delivery_channel_check
  check (delivery_channel in ('in-app', 'push', 'both'));

alter table public.notifications
  drop constraint if exists notifications_action_target_check;
alter table public.notifications
  add constraint notifications_action_target_check
  check (action_target in ('route', 'programme', 'notifications'));

create or replace function public.update_app_content(
  updated_content jsonb,
  expected_content_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
  current_version bigint;
  new_version bigint;
begin
  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag app-inhoud wijzigen.' using errcode = '42501';
  end if;
  if jsonb_typeof(updated_content) <> 'object' then
    raise exception 'De inhoudssnapshot is ongeldig.' using errcode = '22023';
  end if;

  select s.version into current_version
  from public.app_content_snapshot s
  where s.singleton_id = true
  for update;

  if current_version is distinct from expected_content_version then
    raise exception 'De app-inhoud is intussen gewijzigd. Vernieuw en probeer opnieuw.' using errcode = '40001';
  end if;

  new_version := current_version + 1;
  update public.app_content_snapshot
  set version = new_version,
      content = updated_content,
      content_hash = md5(updated_content::text),
      updated_at = now(),
      updated_by = organizer_profile_id
  where singleton_id = true;

  return jsonb_build_object('version', new_version, 'contentHash', md5(updated_content::text));
end;
$$;

create or replace function public.get_organizer_message_recipients()
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
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.active = true
      and p.profile_type = 'organizer'
  ) then
    raise exception 'Alleen een actieve organisator mag ontvangers bekijken.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', source.id,
    'displayName', source.display_name,
    'email', source.email,
    'role', source.profile_type,
    'classCode', source.class_code
  ) order by source.profile_type, source.class_code, source.display_name), '[]'::jsonb)
  into result
  from (
    select distinct on (p.id)
      p.id,
      concat_ws(' ', p.first_name, p.name_prefix, p.last_name) as display_name,
      p.email,
      p.profile_type::text as profile_type,
      c.code as class_code
    from public.profiles p
    left join public.class_memberships cm on cm.profile_id = p.id and cm.active = true
    left join public.classes c on c.id = cm.class_id and c.active = true
    where p.active = true and p.profile_type in ('buddy', 'poer')
    order by p.id, cm.updated_at desc nulls last
  ) source;
  return result;
end;
$$;

create or replace function public.send_organizer_notification(
  message_title text,
  message_body text,
  target_class_codes text[] default '{}'::text[],
  target_profile_ids uuid[] default '{}'::uuid[],
  delivery_channel text default 'in-app',
  action_target text default 'notifications'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_count integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.active = true
      and p.profile_type = 'organizer'
  ) then
    raise exception 'Alleen een actieve organisator mag berichten versturen.' using errcode = '42501';
  end if;
  if nullif(btrim(message_title), '') is null or nullif(btrim(message_body), '') is null then
    raise exception 'Titel en berichttekst zijn verplicht.' using errcode = '22023';
  end if;
  if delivery_channel not in ('in-app', 'push', 'both') then
    raise exception 'Onbekend verzendkanaal.' using errcode = '22023';
  end if;
  if action_target not in ('route', 'programme', 'notifications') then
    raise exception 'Onbekend klikdoel.' using errcode = '22023';
  end if;

  with recipients as (
    select distinct p.id
    from public.profiles p
    left join public.class_memberships cm on cm.profile_id = p.id and cm.active = true
    left join public.classes c on c.id = cm.class_id and c.active = true
    where p.active = true
      and (
        (p.profile_type = 'student' and c.code = any(coalesce(target_class_codes, '{}'::text[])))
        or (p.profile_type in ('buddy', 'poer') and p.id = any(coalesce(target_profile_ids, '{}'::uuid[])))
      )
  ), inserted as (
    insert into public.notifications (
      recipient_profile_id, kind, title, body, delivery_channel, action_target
    )
    select r.id, 'broadcast', btrim(message_title), btrim(message_body), delivery_channel, action_target
    from recipients r
    returning id
  )
  select count(*) into recipient_count from inserted;

  if recipient_count = 0 then
    raise exception 'Er zijn geen actieve ontvangers geselecteerd.' using errcode = '22023';
  end if;
  return jsonb_build_object('recipientCount', recipient_count);
end;
$$;

revoke all on function public.update_app_content(jsonb, bigint) from public, anon;
revoke all on function public.get_organizer_message_recipients() from public, anon;
revoke all on function public.send_organizer_notification(text, text, text[], uuid[], text, text) from public, anon;
grant execute on function public.update_app_content(jsonb, bigint) to authenticated;
grant execute on function public.get_organizer_message_recipients() to authenticated;
grant execute on function public.send_organizer_notification(text, text, text[], uuid[], text, text) to authenticated;
