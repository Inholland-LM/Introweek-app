-- Introweek-app: transactionele deelnemersimport met auditlog en gerichte meldingen.

create table if not exists public.people_imports (
  id uuid primary key default gen_random_uuid(),
  created_by_profile_id uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(),
  total_incoming integer not null,
  new_count integer not null,
  changed_count integer not null,
  unchanged_count integer not null,
  deactivated_count integer not null,
  state_version_before text not null,
  state_version_after text
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  import_id uuid references public.people_imports(id) on delete set null,
  kind text not null check (kind in ('welcome', 'class_changed', 'class_member_arrived', 'class_member_left')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_profile_id, created_at desc);

alter table public.people_imports enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.people_imports from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;

grant select on table public.people_imports to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists "people_imports_select_organizer" on public.people_imports;
create policy "people_imports_select_organizer"
on public.people_imports
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.profile_type = 'organizer'
      and p.active = true
  )
);

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (
  recipient_profile_id in (
    select p.id
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "notifications_mark_own_read" on public.notifications;
create policy "notifications_mark_own_read"
on public.notifications
for update
to authenticated
using (
  recipient_profile_id in (
    select p.id
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
  )
)
with check (
  recipient_profile_id in (
    select p.id
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
  )
);

create or replace function private.people_data_version()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select md5(
    coalesce((
      select jsonb_agg(jsonb_build_array(
        p.id,
        p.student_number,
        p.first_name,
        p.name_prefix,
        p.last_name,
        p.email,
        p.profile_type,
        p.active,
        p.updated_at
      ) order by p.id)::text
      from public.profiles p
    ), '[]')
    || '|'
    || coalesce((
      select jsonb_agg(jsonb_build_array(
        cm.id,
        cm.profile_id,
        cm.class_id,
        cm.membership_role,
        cm.active,
        cm.updated_at
      ) order by cm.id)::text
      from public.class_memberships cm
    ), '[]')
    || '|'
    || coalesce((
      select jsonb_agg(jsonb_build_array(
        c.id,
        c.code,
        c.active,
        c.updated_at
      ) order by c.id)::text
      from public.classes c
    ), '[]')
  );
$$;

revoke all on function private.people_data_version() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.preview_people_import_core(jsonb)') is null then
    alter function public.preview_people_import(jsonb)
      rename to preview_people_import_core;
  end if;
end
$$;

revoke all on function public.preview_people_import_core(jsonb) from public, anon, authenticated;

create or replace function public.preview_people_import(import_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comparison jsonb;
begin
  lock table public.profiles, public.class_memberships, public.classes
    in share mode;

  comparison := public.preview_people_import_core(import_rows);
  return comparison || jsonb_build_object('stateVersion', private.people_data_version());
end;
$$;

revoke all on function public.preview_people_import(jsonb) from public, anon;
grant execute on function public.preview_people_import(jsonb) to authenticated;

create or replace function public.apply_people_import(
  import_rows jsonb,
  expected_state_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id uuid;
  comparison jsonb;
  current_state_version text;
  resulting_state_version text;
  import_record_id uuid;
  item jsonb;
  missing_profile record;
  v_profile_id uuid;
  v_class_id uuid;
  v_old_class_code text;
  v_student_number text;
  v_first_name text;
  v_name_prefix text;
  v_last_name text;
  v_email_address text;
  v_profile_role public.profile_type;
  v_class_code text;
  v_is_active boolean;
  v_display_name text;
begin
  select p.id into caller_profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.profile_type = 'organizer'
    and p.active = true;

  if caller_profile_id is null then
    raise exception 'Alleen een actieve organisator mag deelnemers verwerken.'
      using errcode = '42501';
  end if;

  lock table public.profiles, public.class_memberships, public.classes
    in share row exclusive mode;

  current_state_version := private.people_data_version();
  if expected_state_version is null or expected_state_version <> current_state_version then
    raise exception 'De deelnemersgegevens zijn na de voorvertoning gewijzigd. Vergelijk het bestand opnieuw.'
      using errcode = '40001';
  end if;

  comparison := public.preview_people_import_core(import_rows);

  if (comparison->>'conflicts')::integer > 0 then
    raise exception 'Los alle conflicten op voordat je de import verwerkt.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(comparison->'deactivations') deactivation
    where deactivation->>'profileId' = caller_profile_id::text
  ) then
    raise exception 'De actieve organisator moet zelf in het importbestand blijven staan.'
      using errcode = '22023';
  end if;

  insert into public.people_imports (
    created_by_profile_id,
    total_incoming,
    new_count,
    changed_count,
    unchanged_count,
    deactivated_count,
    state_version_before
  ) values (
    caller_profile_id,
    (comparison->>'totalIncoming')::integer,
    (comparison->>'new')::integer,
    (comparison->>'changed')::integer,
    (comparison->>'unchanged')::integer,
    (comparison->>'deactivated')::integer,
    current_state_version
  ) returning id into import_record_id;

  for item in select value from jsonb_array_elements(import_rows)
  loop
    v_student_number := nullif(btrim(item->>'studentNumber'), '');
    v_first_name := btrim(item->>'firstName');
    v_name_prefix := nullif(btrim(item->>'namePrefix'), '');
    v_last_name := btrim(item->>'lastName');
    v_email_address := lower(btrim(item->>'email'));
    v_profile_role := (item->>'role')::public.profile_type;
    v_class_code := nullif(upper(btrim(item->>'classCode')), '');
    v_is_active := (item->>'active')::boolean;
    v_display_name := concat_ws(' ', v_first_name, v_name_prefix, v_last_name);
    v_profile_id := null;
    v_old_class_code := null;
    v_class_id := null;

    if v_profile_role in ('student', 'buddy') then
      select p.id into v_profile_id
      from public.profiles p
      where p.student_number = v_student_number;
    else
      select p.id into v_profile_id
      from public.profiles p
      where p.email = v_email_address;
    end if;

    if v_profile_id is not null then
      select c.code into v_old_class_code
      from public.class_memberships cm
      join public.classes c on c.id = cm.class_id
      where cm.profile_id = v_profile_id
        and cm.active = true
      order by cm.updated_at desc, cm.created_at desc
      limit 1;

      update public.profiles
      set student_number = v_student_number,
          first_name = v_first_name,
          name_prefix = v_name_prefix,
          last_name = v_last_name,
          email = v_email_address,
          profile_type = v_profile_role,
          active = v_is_active,
          updated_at = now()
      where id = v_profile_id
        and (
          student_number is distinct from v_student_number
          or first_name is distinct from v_first_name
          or name_prefix is distinct from v_name_prefix
          or last_name is distinct from v_last_name
          or email is distinct from v_email_address
          or profile_type is distinct from v_profile_role
          or active is distinct from v_is_active
        );
    else
      insert into public.profiles (
        student_number,
        first_name,
        name_prefix,
        last_name,
        email,
        profile_type,
        active
      ) values (
        v_student_number,
        v_first_name,
        v_name_prefix,
        v_last_name,
        v_email_address,
        v_profile_role,
        v_is_active
      ) returning id into v_profile_id;
    end if;

    if v_class_code is not null then
      select c.id into v_class_id
      from public.classes c
      where c.code = v_class_code
        and c.active = true;
    end if;

    update public.class_memberships cm
    set active = false,
        updated_at = now()
    where cm.profile_id = v_profile_id
      and cm.active = true
      and (v_class_id is null or cm.class_id <> v_class_id or not v_is_active);

    if v_class_id is not null and v_profile_role <> 'organizer' and v_is_active then
      insert into public.class_memberships (
        profile_id,
        class_id,
        membership_role,
        active
      ) values (
        v_profile_id,
        v_class_id,
        v_profile_role::text::public.membership_role,
        v_is_active
      )
      on conflict (profile_id, class_id, membership_role)
      do update set active = excluded.active,
                    updated_at = now()
      where class_memberships.active is distinct from excluded.active;
    end if;

    if v_is_active and v_old_class_code is distinct from v_class_code then
      insert into public.notifications (
        recipient_profile_id,
        import_id,
        kind,
        title,
        body
      ) values (
        v_profile_id,
        import_record_id,
        case when v_old_class_code is null then 'welcome' else 'class_changed' end,
        case
          when v_old_class_code is null then 'Welkom bij ' || v_class_code
          when v_class_code is null then 'Je klaskoppeling is gewijzigd'
          else 'Je klas is gewijzigd'
        end,
        case
          when v_old_class_code is null then 'Je bent ingedeeld in ' || v_class_code || '.'
          when v_class_code is null then 'Je bent niet langer aan een klas gekoppeld.'
          else 'Je gaat van ' || v_old_class_code || ' naar ' || v_class_code || '.'
        end
      );

      if v_profile_role = 'student' then
        insert into public.notifications (
          recipient_profile_id,
          import_id,
          kind,
          title,
          body
        )
        select distinct
          cm.profile_id,
          import_record_id,
          'class_member_arrived',
          'Wijziging in ' || c.code,
          case
            when v_old_class_code is null then v_display_name || ' is toegevoegd aan ' || v_class_code || '.'
            else v_display_name || ' wisselt van ' || v_old_class_code || ' naar ' || v_class_code || '.'
          end
        from public.class_memberships cm
        join public.classes c on c.id = cm.class_id
        join public.profiles recipient on recipient.id = cm.profile_id
        where c.code in (v_old_class_code, v_class_code)
          and cm.membership_role in ('buddy', 'poer')
          and cm.active = true
          and recipient.active = true
          and cm.profile_id <> v_profile_id;
      end if;
    end if;
  end loop;

  for missing_profile in
    select
      p.id,
      p.first_name,
      p.name_prefix,
      p.last_name,
      p.profile_type,
      c.code as old_class_code
    from public.profiles p
    left join lateral (
      select linked_class.code
      from public.class_memberships cm
      join public.classes linked_class on linked_class.id = cm.class_id
      where cm.profile_id = p.id
        and cm.active = true
      order by cm.updated_at desc, cm.created_at desc
      limit 1
    ) c on true
    where p.active = true
      and not exists (
        select 1
        from jsonb_array_elements(import_rows) source(imported_item)
        where (p.profile_type in ('student', 'buddy') and btrim(imported_item->>'studentNumber') = p.student_number)
           or (p.profile_type in ('poer', 'organizer') and lower(btrim(imported_item->>'email')) = p.email)
      )
  loop
    if missing_profile.profile_type = 'student' and missing_profile.old_class_code is not null then
      insert into public.notifications (
        recipient_profile_id,
        import_id,
        kind,
        title,
        body
      )
      select distinct
        cm.profile_id,
        import_record_id,
        'class_member_left',
        'Wijziging in ' || missing_profile.old_class_code,
        concat_ws(' ', missing_profile.first_name, missing_profile.name_prefix, missing_profile.last_name)
          || ' is niet meer actief in ' || missing_profile.old_class_code || '.'
      from public.class_memberships cm
      join public.classes c on c.id = cm.class_id
      join public.profiles recipient on recipient.id = cm.profile_id
      where c.code = missing_profile.old_class_code
        and cm.membership_role in ('buddy', 'poer')
        and cm.active = true
        and recipient.active = true;
    end if;

    update public.class_memberships
    set active = false,
        updated_at = now()
    where profile_id = missing_profile.id
      and active = true;

    update public.profiles
    set active = false,
        updated_at = now()
    where id = missing_profile.id;
  end loop;

  resulting_state_version := private.people_data_version();

  update public.people_imports
  set state_version_after = resulting_state_version
  where id = import_record_id;

  return comparison || jsonb_build_object(
    'importId', import_record_id,
    'stateVersion', resulting_state_version,
    'appliedAt', now()
  );
end;
$$;

revoke all on function public.apply_people_import(jsonb, text) from public, anon;
grant execute on function public.apply_people_import(jsonb, text) to authenticated;

comment on function public.apply_people_import(jsonb, text) is
  'Verwerkt een bevestigde deelnemersimport atomair en maakt gerichte meldingen voor klaswisselingen.';
