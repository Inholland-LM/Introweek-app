-- Herleidbare berichtgeschiedenis en blijvend doelgroep-label.
-- Een klaswissel wijzigt oude meldingen niet: de oorspronkelijke doelgroep
-- blijft op iedere persoonlijke melding opgeslagen.

alter table public.notifications
  add column if not exists source_class_code text,
  add column if not exists source_audience_label text;

create table if not exists public.organizer_message_history (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  scheduled_at timestamptz not null default now(),
  target_class_codes text[] not null default '{}'::text[],
  target_profile_ids uuid[] not null default '{}'::uuid[],
  delivery_channel text not null default 'in-app' check (delivery_channel in ('in-app', 'push', 'both')),
  status text not null default 'sent' check (status in ('scheduled', 'sent', 'cancelled')),
  recipient_count integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.organizer_message_history enable row level security;
revoke all on table public.organizer_message_history from public, anon, authenticated;

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
  organizer_profile_id uuid;
  history_id uuid;
  v_recipient_count integer;
begin
  select p.id into organizer_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type = 'organizer'
  limit 1;

  if organizer_profile_id is null then
    raise exception 'Alleen een actieve organisator mag berichten versturen.' using errcode = '42501';
  end if;
  if nullif(btrim(message_title), '') is null or nullif(btrim(message_body), '') is null then
    raise exception 'Titel en berichttekst zijn verplicht.' using errcode = '22023';
  end if;
  if delivery_channel not in ('in-app', 'push', 'both') then
    raise exception 'Onbekend verzendkanaal.' using errcode = '22023';
  end if;

  insert into public.organizer_message_history (
    title, body, target_class_codes, target_profile_ids, delivery_channel,
    status, created_by, sent_at
  ) values (
    btrim(message_title), btrim(message_body), coalesce(target_class_codes, '{}'::text[]),
    coalesce(target_profile_ids, '{}'::uuid[]), delivery_channel, 'sent', organizer_profile_id, now()
  ) returning id into history_id;

  with recipients as (
    select distinct on (p.id)
      p.id,
      c.code as source_class_code,
      case
        when p.profile_type = 'student' and c.code is not null then 'Ontvangen als lid van ' || c.code
        when p.profile_type = 'buddy' then 'Ontvangen als buddy' || coalesce(' van ' || c.code, '')
        when p.profile_type = 'poer' then 'Ontvangen als PO''er' || coalesce(' van ' || c.code, '')
        else 'Ontvangen als deelnemer'
      end as source_audience_label
    from public.profiles p
    left join public.class_memberships cm on cm.profile_id = p.id and cm.active = true
    left join public.classes c on c.id = cm.class_id and c.active = true
    where p.active = true
      and (
        (p.profile_type = 'student' and c.code = any(coalesce(target_class_codes, '{}'::text[])))
        or (p.profile_type in ('buddy', 'poer') and p.id = any(coalesce(target_profile_ids, '{}'::uuid[])))
      )
    order by p.id, cm.updated_at desc nulls last
  ), inserted as (
    insert into public.notifications (
      recipient_profile_id, kind, title, body, delivery_channel, action_target,
      source_class_code, source_audience_label
    )
    select r.id, 'broadcast', btrim(message_title), btrim(message_body), delivery_channel,
      action_target, r.source_class_code, r.source_audience_label
    from recipients r
    returning id
  )
  select count(*) into v_recipient_count from inserted;

  if v_recipient_count = 0 then
    delete from public.organizer_message_history where id = history_id;
    raise exception 'Er zijn geen actieve ontvangers geselecteerd.' using errcode = '22023';
  end if;

  update public.organizer_message_history
  set recipient_count = v_recipient_count
  where id = history_id;

  return jsonb_build_object('recipientCount', v_recipient_count, 'messageId', history_id);
end;
$$;

create or replace function public.get_organizer_message_history()
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
    raise exception 'Alleen een actieve organisator mag berichtgeschiedenis bekijken.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'title', h.title,
    'body', h.body,
    'scheduledAt', h.scheduled_at,
    'targets', coalesce((
      select jsonb_agg(target_label order by target_label)
      from (
        select distinct class_code as target_label
        from unnest(h.target_class_codes) class_code
        where nullif(btrim(class_code), '') is not null
        union
        select distinct concat_ws(' ', p.first_name, nullif(p.name_prefix, ''), p.last_name) as target_label
        from public.profiles p
        where p.id = any(h.target_profile_ids)
      ) target_labels
    ), '[]'::jsonb),
    'channel', h.delivery_channel,
    'status', h.status,
    'recipientCount', h.recipient_count
  ) order by h.scheduled_at desc), '[]'::jsonb)
  into result
  from public.organizer_message_history h;
  return result;
end;
$$;

revoke all on function public.get_organizer_message_history() from public, anon;
grant execute on function public.get_organizer_message_history() to authenticated;
