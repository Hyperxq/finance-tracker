begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.allowed_member_emails (
  email_hash text primary key,
  display_name text not null
);

insert into private.allowed_member_emails (email_hash, display_name)
values
  ('2170f37fad2e4bf7a8dc15023add191ef8ea0e77c34c0d2fafa8315f9d3f355d', 'Daniel'),
  ('795445850d72ccc615a7be374f9cb3af44298af1dd9dfb5468c10f57491c25e9', 'Andrea')
on conflict (email_hash) do update set display_name = excluded.display_name;

create table public.households (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.households (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Daniel & Andrea')
on conflict (id) do update set name = excluded.name;

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant text not null check (length(trim(merchant)) > 0),
  receipt_number text,
  purchased_at timestamptz not null,
  total numeric(12, 2) not null check (total >= 0),
  confidence integer not null check (confidence between 0 and 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  household_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  amount numeric(12, 2) not null check (amount >= 0),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (receipt_id, household_id)
    references public.receipts(id, household_id) on delete cascade
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  issuer text not null default 'BNZ',
  nickname text not null check (length(trim(nickname)) > 0),
  holder text not null check (length(trim(holder)) > 0),
  last_four text not null check (last_four ~ '^\d{4}$'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, issuer, last_four)
);

create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  card_id uuid not null,
  file_name text not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  period_start date not null,
  period_end date not null,
  status text not null default 'Imported' check (status = 'Imported'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (id, household_id),
  unique (household_id, fingerprint),
  foreign key (card_id, household_id)
    references public.cards(id, household_id) on delete restrict
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null,
  household_id uuid not null,
  card_id uuid not null,
  transaction_date date not null,
  merchant text not null check (length(trim(merchant)) > 0),
  category text not null,
  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (statement_id, household_id)
    references public.bank_statements(id, household_id) on delete cascade,
  foreign key (card_id, household_id)
    references public.cards(id, household_id) on delete restrict
);

create index receipt_items_household_id_idx on public.receipt_items (household_id);
create index receipts_household_purchased_at_idx on public.receipts (household_id, purchased_at desc);
create index statements_household_period_idx on public.bank_statements (household_id, period_end desc);
create index transactions_household_date_idx on public.bank_transactions (household_id, transaction_date desc);

create or replace function public.hook_restrict_household_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  incoming_email_hash text;
  provider text;
begin
  provider := coalesce(event->'user'->'app_metadata'->>'provider', '');
  if provider <> 'google' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Use an authorized Google account to access this household.'
      )
    );
  end if;

  incoming_email_hash := encode(
    extensions.digest(lower(coalesce(event->'user'->>'email', '')), 'sha256'),
    'hex'
  );

  if exists (
    select 1 from private.allowed_member_emails as allowed
    where allowed.email_hash = incoming_email_hash
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Google account is not a member of this household.'
    )
  );
end;
$$;

grant usage on schema public, private, extensions to supabase_auth_admin;
grant select on private.allowed_member_emails to supabase_auth_admin;
grant execute on function public.hook_restrict_household_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_household_signup(jsonb) from public, anon, authenticated;

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
  where email_hash = encode(extensions.digest(lower(coalesce(new.email, '')), 'sha256'), 'hex');

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

insert into public.household_members (household_id, user_id, display_name, role)
select
  '11111111-1111-4111-8111-111111111111',
  auth_user.id,
  allowed.display_name,
  case when allowed.display_name = 'Daniel' then 'owner' else 'member' end
from auth.users as auth_user
join private.allowed_member_emails as allowed
  on allowed.email_hash = encode(
    extensions.digest(lower(coalesce(auth_user.email, '')), 'sha256'),
    'hex'
  )
where coalesce(auth_user.raw_app_meta_data->>'provider', '') = 'google'
on conflict (user_id) do update set display_name = excluded.display_name;

create or replace function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = auth.uid()
  );
$$;

create or replace function private.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.current_household_id() to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.cards enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_transactions enable row level security;

create policy "members can read their household"
on public.households for select to authenticated
using (private.is_household_member(id));

create policy "members can read household membership"
on public.household_members for select to authenticated
using (private.is_household_member(household_id));

create policy "members can manage receipts"
on public.receipts for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "members can manage receipt items"
on public.receipt_items for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "members can manage cards"
on public.cards for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "members can manage bank statements"
on public.bank_statements for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "members can manage bank transactions"
on public.bank_transactions for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

grant select on public.households, public.household_members to authenticated;
grant select, insert, update, delete on public.receipts, public.receipt_items to authenticated;
grant select, insert, update, delete on public.cards, public.bank_statements, public.bank_transactions to authenticated;

create or replace function public.save_card(payload jsonb)
returns public.cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  household uuid;
  saved public.cards;
begin
  household := private.current_household_id();
  if household is null then
    raise exception 'Household access required' using errcode = '42501';
  end if;

  insert into public.cards (household_id, issuer, nickname, holder, last_four)
  values (
    household,
    coalesce(nullif(trim(payload->>'issuer'), ''), 'BNZ'),
    trim(payload->>'nickname'),
    trim(payload->>'holder'),
    payload->>'lastFour'
  ) returning * into saved;

  return saved;
end;
$$;

create or replace function public.save_receipt(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  household uuid;
  receipt uuid;
  item record;
begin
  household := private.current_household_id();
  if household is null then
    raise exception 'Household access required' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'At least one receipt item is required' using errcode = '22023';
  end if;

  insert into public.receipts (
    household_id,
    merchant,
    receipt_number,
    purchased_at,
    total,
    confidence
  ) values (
    household,
    trim(payload->>'merchant'),
    nullif(trim(payload->>'receiptNumber'), ''),
    (payload->>'purchasedAt')::timestamptz,
    (payload->>'total')::numeric,
    (payload->>'confidence')::integer
  ) returning id into receipt;

  for item in
    select value, (ordinality - 1)::integer as position
    from jsonb_array_elements(payload->'items') with ordinality
  loop
    insert into public.receipt_items (
      receipt_id,
      household_id,
      name,
      quantity,
      unit_price,
      amount,
      position
    ) values (
      receipt,
      household,
      trim(item.value->>'name'),
      (item.value->>'quantity')::numeric,
      (item.value->>'unitPrice')::numeric,
      (item.value->>'amount')::numeric,
      item.position
    );
  end loop;

  return receipt;
end;
$$;

create or replace function public.import_bank_statement(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  household uuid;
  statement uuid;
  transaction record;
begin
  household := private.current_household_id();
  if household is null then
    raise exception 'Household access required' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(payload->'transactions', '[]'::jsonb)) = 0 then
    raise exception 'At least one bank transaction is required' using errcode = '22023';
  end if;

  insert into public.bank_statements (
    household_id,
    card_id,
    file_name,
    fingerprint,
    period_start,
    period_end
  ) values (
    household,
    (payload->>'cardId')::uuid,
    payload->>'fileName',
    payload->>'fingerprint',
    (payload->>'periodStart')::date,
    (payload->>'periodEnd')::date
  ) returning id into statement;

  for transaction in
    select value from jsonb_array_elements(payload->'transactions')
  loop
    insert into public.bank_transactions (
      statement_id,
      household_id,
      card_id,
      transaction_date,
      merchant,
      category,
      amount
    ) values (
      statement,
      household,
      (payload->>'cardId')::uuid,
      (transaction.value->>'date')::date,
      trim(transaction.value->>'merchant'),
      transaction.value->>'category',
      (transaction.value->>'amount')::numeric
    );
  end loop;

  return statement;
end;
$$;

revoke execute on function public.save_receipt(jsonb) from public, anon;
revoke execute on function public.import_bank_statement(jsonb) from public, anon;
revoke execute on function public.save_card(jsonb) from public, anon;
grant execute on function public.save_receipt(jsonb) to authenticated;
grant execute on function public.import_bank_statement(jsonb) to authenticated;
grant execute on function public.save_card(jsonb) to authenticated;

commit;
