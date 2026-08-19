-- Persoonswijzigingen: gerichte notificatie en actuele klas zonder polling.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'class_memberships'
  ) then
    alter publication supabase_realtime add table public.class_memberships;
  end if;
end;
$$;

create or replace function public.notify_organizer_person_change(
  target_profile_id uuid,
  message_title text,
  message_body text,
  delivery_channel text default 'both'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_profile_id uuid;
  target_class_code text;
  history_id uuid;
begin
  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag notificaties versturen.' using errcode = '42501';
  end if;
  if nullif(btrim(message_title), '') is null or nullif(btrim(message_body), '') is null then
    raise exception 'Titel en berichttekst zijn verplicht.' using errcode = '22023';
  end if;
  if delivery_channel not in ('in-app', 'push', 'both') then
    raise exception 'Onbekend verzendkanaal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_profile_id and p.active = true) then
    raise exception 'De geselecteerde persoon is niet actief.' using errcode = '22023';
  end if;

  select c.code into target_class_code
  from public.class_memberships cm
  join public.classes c on c.id = cm.class_id
  where cm.profile_id = target_profile_id and cm.active = true
  order by cm.updated_at desc
  limit 1;

  insert into public.organizer_message_history (
    title, body, target_profile_ids, delivery_channel, status, recipient_count, created_by, sent_at
  ) values (
    btrim(message_title), btrim(message_body), array[target_profile_id], delivery_channel,
    'sent', 1, organizer_profile_id, now()
  ) returning id into history_id;

  insert into public.notifications (
    recipient_profile_id, kind, title, body, delivery_channel, action_target,
    source_class_code, source_audience_label
  ) values (
    target_profile_id, 'class_changed', btrim(message_title), btrim(message_body),
    delivery_channel, 'notifications', target_class_code,
    case when target_class_code is null then 'Persoonlijke profielwijziging'
      else 'Ontvangen als lid van ' || target_class_code end
  );

  return jsonb_build_object('recipientCount', 1, 'messageId', history_id);
end;
$$;

revoke all on function public.notify_organizer_person_change(uuid, text, text, text) from public, anon;
grant execute on function public.notify_organizer_person_change(uuid, text, text, text) to authenticated;
