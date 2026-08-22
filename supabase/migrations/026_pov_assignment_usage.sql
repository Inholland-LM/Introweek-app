-- Geef een student of buddy uitsluitend de geaggregeerde bezetting van de
-- eigen klas voor een POV-opdracht. Foto's, inzenders en metadata blijven privé.

create or replace function public.get_my_pov_assignment_usage(requested_assignment_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  profile_record record;
  assignment_record jsonb;
  max_uploads integer;
  used_uploads integer;
begin
  select p.id, c.code as class_code
  into profile_record
  from public.profiles p
  join public.class_memberships cm on cm.profile_id = p.id and cm.active = true
  join public.classes c on c.id = cm.class_id and c.active = true
  where p.auth_user_id = (select auth.uid())
    and p.active = true
    and p.profile_type in ('student', 'buddy')
  order by cm.updated_at desc
  limit 1;

  if profile_record.id is null then
    raise exception 'Alleen een actieve student of buddy met klas kan de beschikbare plekken bekijken.' using errcode = '42501';
  end if;

  select assignment
  into assignment_record
  from public.app_content_snapshot snapshot,
       lateral jsonb_array_elements(coalesce(snapshot.content->'povAssignments', '[]'::jsonb)) assignment
  where snapshot.singleton_id = true
    and assignment->>'id' = requested_assignment_id
    and coalesce((assignment->>'active')::boolean, false) = true
    and (
      assignment->>'classCodes' = 'all'
      or (
        jsonb_typeof(assignment->'classCodes') = 'array'
        and assignment->'classCodes' ? profile_record.class_code
      )
    )
  limit 1;

  if assignment_record is null then
    raise exception 'Deze POV-opdracht is niet beschikbaar voor jouw klas.' using errcode = '22023';
  end if;

  max_uploads := greatest(1, least(10, coalesce((assignment_record->>'maxUploads')::integer, 5)));

  select count(*)
  into used_uploads
  from public.pov_submissions s
  where s.class_code = profile_record.class_code
    and s.assignment_id = requested_assignment_id
    and (
      (s.status = 'uploaded' and coalesce(s.review_status, 'pending') <> 'rejected')
      or (s.status = 'pending' and s.created_at > now() - interval '30 minutes')
    );

  return jsonb_build_object(
    'used', used_uploads,
    'maximum', max_uploads,
    'remaining', greatest(0, max_uploads - used_uploads),
    'deadlineAt', assignment_record->>'deadlineAt'
  );
end;
$$;

revoke all on function public.get_my_pov_assignment_usage(text) from public, anon;
grant execute on function public.get_my_pov_assignment_usage(text) to authenticated;
