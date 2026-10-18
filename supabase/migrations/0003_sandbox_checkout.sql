-- One sandbox retailer. All monetary values in these tables are USD cents.
-- These tables are API-private: even the owner cannot write payment state directly.
create table public.checkout_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stripe_customer_id text unique
);

create table public.checkout_offers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.items(id) on delete cascade,
  merchant text not null default 'Cedar Electronics',
  title text not null,
  price_cents integer not null check (price_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  active boolean not null default true,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  check (price_cents::bigint + shipping_cents between 50 and 99999999)
);

create table public.checkout_watches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  offer_id uuid not null references public.checkout_offers(id) on delete cascade,
  customer_id text not null,
  payment_method_id text not null,
  setup_intent_id text not null,
  threshold_cents integer not null check (threshold_cents between 50 and 99999999),
  consent_version text not null check (consent_version = 'sandbox-autobuy-v1'),
  consent_at timestamptz not null default now(),
  state text not null check (state in ('active', 'charging', 'paused', 'purchased', 'canceled'))
);

create table public.checkout_orders (
  id uuid primary key default gen_random_uuid(),
  -- Preserve the receipt when the library item is deleted.
  item_id uuid references public.items(id) on delete set null,
  user_id uuid not null references auth.users(id),
  offer_id uuid,
  watch_id uuid,
  request_id uuid not null,
  mode text not null check (mode in ('buy_now', 'autobuy')),
  customer_id text not null,
  payment_method_id text,
  merchant text not null,
  title text not null,
  amount_cents integer not null check (amount_cents between 50 and 99999999),
  currency text not null default 'usd' check (currency = 'usd'),
  stripe_payment_intent_id text unique,
  status text not null default 'creating' check (status in
    ('creating', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'canceled')),
  paid_amount_cents integer,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, request_id)
);
-- Includes failed/unknown attempts until Stripe confirms cancellation. No second charge.
create unique index checkout_one_purchase_per_item on public.checkout_orders(item_id)
  where status <> 'canceled';
create index checkout_active_watches on public.checkout_watches(item_id) where state = 'active';
create table public.checkout_webhook_events (
  id text primary key,
  processed_at timestamptz not null default now()
);

alter table public.checkout_customers enable row level security;
alter table public.checkout_offers enable row level security;
alter table public.checkout_watches enable row level security;
alter table public.checkout_orders enable row level security;
alter table public.checkout_webhook_events enable row level security;
revoke all on public.checkout_customers, public.checkout_offers, public.checkout_watches,
  public.checkout_orders, public.checkout_webhook_events from anon, authenticated;
grant all on public.checkout_customers, public.checkout_offers, public.checkout_watches,
  public.checkout_orders, public.checkout_webhook_events to service_role;

-- Existing direct library inserts/edits remain supported, except payment fields.
create function public.checkout_guard_item() returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.checkout_status <> 'none' or new.target_price is not null then
        raise exception 'payment_fields_read_only' using errcode = '42501';
      end if;
    elsif new.checkout_status is distinct from old.checkout_status
       or new.target_price is distinct from old.target_price
       or new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'payment_fields_read_only' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger checkout_guard_item before insert or update on public.items
  for each row execute function public.checkout_guard_item();

-- SECURITY DEFINER lets a library delete check API-private orders. The item row
-- lock serializes this with claim/watch/cancel. Never delete an unresolved charge.
create function public.checkout_guard_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from checkout_orders where item_id = old.id
    and status not in ('succeeded', 'canceled')) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger checkout_guard_delete before delete on public.items
  for each row execute function public.checkout_guard_delete();

-- All public RPCs below are callable only by the service role. Item locks always
-- precede offer/watch/order locks. Never hold a transaction open across Stripe I/O.
create function public.checkout_set_watch(p_user uuid, p_item uuid, p_setup text,
  p_customer text, p_method text, p_threshold integer, p_consent text)
returns public.checkout_watches language plpgsql set search_path = public as $$
declare v_offer checkout_offers; v_watch checkout_watches;
begin
  perform 1 from items where id = p_item and user_id = p_user for update;
  if not found then raise exception 'item_not_found'; end if;
  select * into v_offer from checkout_offers where item_id = p_item and active for update;
  if not found then raise exception 'unsupported_retailer'; end if;
  if exists(select 1 from checkout_orders where item_id = p_item and status <> 'canceled') then
    raise exception 'payment_in_progress';
  end if;
  insert into checkout_watches(item_id, user_id, offer_id, customer_id, payment_method_id,
    setup_intent_id, threshold_cents, consent_version, state)
  values(p_item, p_user, v_offer.id, p_customer, p_method, p_setup, p_threshold, p_consent, 'active')
  on conflict(item_id) do update set
    id = gen_random_uuid(), offer_id = excluded.offer_id, customer_id = excluded.customer_id,
    payment_method_id = excluded.payment_method_id, setup_intent_id = excluded.setup_intent_id,
    threshold_cents = excluded.threshold_cents, consent_version = excluded.consent_version,
    consent_at = now(), state = 'active'
  returning * into v_watch;
  update items set checkout_status = 'watching', target_price = p_threshold / 100.0 where id = p_item;
  return v_watch;
end $$;

create function public.checkout_cancel_watch(p_user uuid, p_item uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform 1 from items where id = p_item and user_id = p_user for update;
  if not found then raise exception 'item_not_found'; end if;
  if exists(select 1 from checkout_orders where item_id = p_item and status <> 'canceled') then
    raise exception 'payment_in_progress';
  end if;
  update checkout_watches set state = 'canceled' where item_id = p_item;
  update items set checkout_status = 'none', target_price = null where id = p_item;
end $$;

create function public.checkout_claim(p_user uuid, p_item uuid, p_request uuid,
  p_customer text, p_revision integer default null, p_watch uuid default null)
returns public.checkout_orders language plpgsql set search_path = public as $$
declare v_offer checkout_offers; v_watch checkout_watches; v_order checkout_orders;
begin
  perform 1 from items where id = p_item and user_id = p_user for update;
  if not found then raise exception 'item_not_found'; end if;
  select * into v_order from checkout_orders where user_id = p_user and request_id = p_request;
  if found then
    if v_order.item_id is distinct from p_item or (v_order.mode = 'autobuy') <> (p_watch is not null) then
      raise exception 'request_id_conflict';
    end if;
    return v_order;
  end if;
  if exists(select 1 from checkout_orders where item_id = p_item and status <> 'canceled') then
    if p_watch is not null then return null; end if;
    raise exception 'payment_in_progress';
  end if;
  select * into v_offer from checkout_offers where item_id = p_item and active for update;
  if not found then
    if p_watch is not null then return null; end if;
    raise exception 'unsupported_retailer';
  end if;
  select * into v_watch from checkout_watches where item_id = p_item for update;
  if p_watch is not null then
    if v_watch.id is distinct from p_watch or v_watch.state <> 'active'
      or v_watch.offer_id <> v_offer.id
      or v_offer.price_cents + v_offer.shipping_cents > v_watch.threshold_cents then return null; end if;
    p_customer := v_watch.customer_id;
  else
    if v_watch.state in ('active', 'charging', 'paused') then raise exception 'cancel_watch_first'; end if;
    if p_revision is distinct from v_offer.revision then raise exception 'quote_changed'; end if;
  end if;
  insert into checkout_orders(item_id, user_id, offer_id, watch_id, request_id, mode,
    customer_id, payment_method_id, merchant, title, amount_cents)
  values(p_item, p_user, v_offer.id, p_watch, p_request,
    case when p_watch is null then 'buy_now' else 'autobuy' end,
    p_customer, case when p_watch is null then null else v_watch.payment_method_id end,
    v_offer.merchant, v_offer.title, v_offer.price_cents + v_offer.shipping_cents)
  returning * into v_order;
  if p_watch is not null then update checkout_watches set state = 'charging' where id = p_watch; end if;
  return v_order;
end $$;

-- Called only with a freshly retrieved Stripe object, never a client-provided
-- status. Event insertion and fulfillment commit together. Success is monotonic.
create function public.checkout_apply_payment(p_order uuid, p_intent text, p_status text,
  p_amount integer, p_paid integer, p_currency text, p_customer text,
  p_failure text default null, p_event text default null)
returns void language plpgsql set search_path = public as $$
declare v_order checkout_orders; v_item uuid;
begin
  select item_id into v_item from checkout_orders where id = p_order;
  if v_item is not null then perform 1 from items where id = v_item for update; end if;
  select * into v_order from checkout_orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.amount_cents <> p_amount or v_order.currency <> p_currency
    or v_order.customer_id <> p_customer
    or (v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_intent)
    or (p_status = 'succeeded' and p_paid <> p_amount) then raise exception 'payment_mismatch'; end if;
  if p_event is not null then
    insert into checkout_webhook_events(id) values(p_event) on conflict do nothing;
    if not found then return; end if;
  end if;
  if v_order.status in ('succeeded', 'canceled') then return; end if;
  -- A late create response must not overwrite an action/failure/processing event.
  if p_status in ('requires_confirmation', 'requires_payment_method') and p_failure is null
    and v_order.status in ('requires_action', 'processing') then return; end if;
  update checkout_orders set stripe_payment_intent_id = p_intent, status = p_status,
    paid_amount_cents = case when p_status = 'succeeded' then p_paid else null end,
    failure_code = p_failure, updated_at = now() where id = p_order;
  if p_status = 'succeeded' then
    update checkout_watches set state = 'purchased' where item_id = v_item;
    update items set checkout_status = 'purchased' where id = v_item;
  elsif p_status = 'canceled' then
    update checkout_watches set state = 'canceled' where id = v_order.watch_id;
    update items set checkout_status = 'none', target_price = null where id = v_item;
  elsif p_status in ('requires_action', 'requires_payment_method') and v_order.mode = 'autobuy' then
    update checkout_watches set state = 'paused' where id = v_order.watch_id;
    update items set checkout_status = 'none' where id = v_item;
  end if;
end $$;

-- Used by the local operator CLI and, later, the server-side listings adapter.
-- Updating a price is intentionally independent from executing the watcher.
create function public.checkout_register_offer(p_item uuid, p_title text, p_price integer,
  p_shipping integer default 0, p_merchant text default 'Cedar Electronics')
returns public.checkout_offers language plpgsql set search_path = public as $$
declare v_offer checkout_offers;
begin
  perform 1 from items where id = p_item for update;
  if not found then raise exception 'item_not_found'; end if;
  insert into checkout_offers(item_id, title, price_cents, shipping_cents, merchant)
  values(p_item, p_title, p_price, p_shipping, p_merchant)
  on conflict(item_id) do update set title = excluded.title, price_cents = excluded.price_cents,
    shipping_cents = excluded.shipping_cents, merchant = excluded.merchant,
    revision = checkout_offers.revision + 1, updated_at = now()
  returning * into v_offer;
  return v_offer;
end $$;

revoke execute on function public.checkout_guard_item(), public.checkout_guard_delete(),
  public.checkout_set_watch(uuid,uuid,text,text,text,integer,text),
  public.checkout_cancel_watch(uuid,uuid), public.checkout_claim(uuid,uuid,uuid,text,integer,uuid),
  public.checkout_apply_payment(uuid,text,text,integer,integer,text,text,text,text),
  public.checkout_register_offer(uuid,text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.checkout_set_watch(uuid,uuid,text,text,text,integer,text),
  public.checkout_cancel_watch(uuid,uuid), public.checkout_claim(uuid,uuid,uuid,text,integer,uuid),
  public.checkout_apply_payment(uuid,text,text,integer,integer,text,text,text,text),
  public.checkout_register_offer(uuid,text,integer,integer,text) to service_role;
