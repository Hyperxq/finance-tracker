begin;

create or replace function private.normalized_google_email_hash(candidate_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      regexp_replace(
        lower(trim(coalesce(candidate_email, ''))),
        '@googlemail\.com$',
        '@gmail.com'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke execute on function private.normalized_google_email_hash(text) from public, anon, authenticated;

create or replace function public.hook_restrict_household_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  provider text;
begin
  provider := coalesce(event->'user'->'app_metadata'->>'provider', '');

  if provider = 'google' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Use Google to access this household.'
    )
  );
end;
$$;

revoke select on private.allowed_member_emails from supabase_auth_admin;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_name text;
begin
  if coalesce(new.raw_app_meta_data->>'provider', '') <> 'google' then
    return new;
  end if;

  select display_name into member_name
  from private.allowed_member_emails
  where email_hash = private.normalized_google_email_hash(new.email);

  if member_name is null then
    return new;
  end if;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (
    '11111111-1111-4111-8111-111111111111',
    new.id,
    member_name,
    case when member_name = 'Daniel' then 'owner' else 'member' end
  )
  on conflict (user_id) do update set display_name = excluded.display_name;

  return new;
end;
$$;

insert into public.household_members (household_id, user_id, display_name, role)
select
  '11111111-1111-4111-8111-111111111111',
  auth_user.id,
  allowed.display_name,
  case when allowed.display_name = 'Daniel' then 'owner' else 'member' end
from auth.users as auth_user
join private.allowed_member_emails as allowed
  on allowed.email_hash = private.normalized_google_email_hash(auth_user.email)
where coalesce(auth_user.raw_app_meta_data->>'provider', '') = 'google'
on conflict (user_id) do update set display_name = excluded.display_name;

commit;
