-- 001_initial — the portal database.
--
-- Living document until launch: schema changes are edits to this file, not new
-- numbered migrations. Append-only discipline begins the day a database exists
-- that cannot be dropped.
--
-- This database holds desired state — which workspaces should exist, and who
-- may reach them. What has actually been materialized lives in the fleet
-- database, on its own credential. Nothing here references it.
--
-- One shared database serving every user, so reads are scoped by RLS on
-- membership. Two roles, created by the bootstrap script (they carry passwords,
-- and a migration is not the place for those):
--
--   portal_service  owns every object. RLS does not apply to an object's owner
--                   unless FORCE is set, and it deliberately is not — this is
--                   how provisioning writes membership rows, and how the
--                   SECURITY DEFINER helpers below escape recursion.
--   portal_app      owns nothing. Every statement it makes passes a policy.
--
-- Migrations run on the portal_service connection.
--
-- Postgres grants CONNECT on every database to PUBLIC, so the first act is to
-- take it back: without this, any role in the cluster — including fleet_service
-- — can open a session here and is stopped only by table grants.
do $$
begin
    execute format('revoke connect on database %I from public', current_database());
    execute format('grant connect on database %I to portal_app', current_database());
end
$$;
--
-- `owner_id` is the account relationship — who pays for this workspace, who may
-- destroy it, who may transfer it. It is not the same question as what someone
-- may do *inside* a workspace, which the workspace's own members table answers
-- and which this column is never consulted for. Keeping the two apart means a
-- workspace that rewrites its own membership still cannot bill anyone or delete
-- itself.
--
-- Not null, and `on delete restrict`: an ownerless workspace can be neither paid
-- for nor destroyed, so deleting a user has to transfer or tear down their
-- workspaces first rather than silently stranding them.

-- One row per subject of the fleet issuer. Identity lives at the issuer; this
-- is the profile the portal renders.
create table users (
    id           uuid not null,
    email        text not null,
    username     text not null,
    display_name text not null,
    avatar_url   text,
    -- The billing customer this person is, once they have one.
    stripe_customer_id text unique,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null
);

-- `lifecycle_state` is what the workspace should be doing, and the authority for
-- it: a machine that is down cannot say whether the ladder parked it, its owner
-- stopped it, or the fleet froze it, and those wake differently.
-- `subdomain` is the *custom* hostname label, and only paid plans set one. Every
-- workspace also answers at a canonical label derived from its id, which is not
-- stored: deriving it means it cannot drift from the id, cannot be edited, and
-- survives a custom name changing — so a webhook URL never breaks.
-- What a plan is, rather than what the code believes a plan is. A row here is a
-- plan that can be sold, including one made for a single customer.
create table plans (
    id                   text not null,
    display_name         text not null,
    -- Display only. Stripe holds the amount that is actually charged.
    price_cents          integer not null default 0,
    currency             text not null default 'usd',
    -- Checkout takes a price, not a product: one product carries many prices.
    stripe_price_id      text,
    stripe_product_id    text,

    -- What the plan buys, and what the fleet reads.
    topology             text not null,
    backend_size         text not null,
    worker_size          text,
    idle_backend_policy  text not null,
    -- How many executions may run at once. Memory follows from it: the machine
    -- running them needs roughly this many isolates' worth.
    execution_concurrency_limit integer not null default 1,

    -- Limits. Null is unlimited.
    max_workflows            integer,
    max_executions_monthly   integer,
    max_workspace_members    integer,
    max_uptime_hours_monthly integer,
    -- How long an execution's recorded session is kept. The row outlives it.
    execution_session_retention_days           integer,

    -- A plan nobody may buy: withdrawn, or written for one customer.
    purchasable          boolean not null default true,
    sort_order           integer not null default 0,

    created_at           timestamp with time zone default now() not null,
    updated_at           timestamp with time zone default now() not null,

    constraint plans_pkey primary key (id),
    constraint plans_topology_check check (topology in ('combined', 'separate')),
    constraint plans_idle_check     check (idle_backend_policy in ('suspend', 'stop', 'none')),
    -- A split topology has a worker to size; a combined one has none.
    constraint plans_worker_size_check check ((topology = 'separate') = (worker_size is not null)),
    constraint plans_concurrency_check check (execution_concurrency_limit >= 1)
);

-- Seeded to exactly what the code did before this table existed.
-- Price ids are per environment, so they are set after the fact rather than
-- baked in here. Pro exists but is not on sale until its shape is settled.
insert into plans (id, display_name, price_cents, topology, backend_size, worker_size, idle_backend_policy,
                   execution_concurrency_limit, max_executions_monthly, max_workspace_members, execution_session_retention_days,
                   purchasable, sort_order) values
    ('free', 'Free', 0,    'combined', 'shared-1x-2048', null,             'suspend', 2,    100, 1,    1,  true,  0),
    ('base', 'Base', 2500, 'separate', 'shared-1x-512',  'shared-4x-7168', 'none',    5,   2500, null, 7,  true,  1),
    ('pro',  'Pro',  6000, 'separate', 'shared-1x-1024', 'shared-4x-7168', 'none',    10, 10000, null, 30, false, 2);

create table workspaces (
    id           uuid not null,
    subdomain    text,
    display_name text not null,
    -- What this workspace should be doing. Its machines follow; what they are
    -- observed doing is the fleet's, and is not mirrored here.
    lifecycle_state text default 'creating' not null,
    -- Why the fleet turned it off. An unpaid invoice and an operator stop are
    -- the same state and a different sentence. Both clear on unfreeze.
    disabled_at     timestamp with time zone,
    disabled_reason text,
    -- Teardown was asked for and threw, so the fleet may still owe cleanup.
    -- Orthogonal to the lifecycle: teardown runs for a destroy and for a failed
    -- provision alike.
    abandoned_at    timestamp with time zone,
    plan         text default 'free' not null,
    owner_id     uuid not null,
    -- The subscription paying for this workspace, and Stripe's view of it.
    -- Mirrored for display; Stripe remains the record.
    stripe_subscription_id text unique,
    subscription_status    text,
    -- The window the payment provider bills over. Usage is counted across it,
    -- so a subscription bought on the 14th resets on the 14th.
    current_period_start   timestamp with time zone,
    current_period_end     timestamp with time zone,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint workspaces_lifecycle_state_check check (lifecycle_state in (
        'creating', 'running', 'sleeping', 'stopped', 'disabled', 'provisioning_failed')),
    constraint workspaces_plan_fkey   foreign key (plan) references plans(id) on delete restrict
);

-- The user x workspace access index, and deliberately nothing more: no role.
--
-- Its only job is answering "which workspaces may this user enter", which is
-- exactly the question a stopped workspace cannot answer for itself. What
-- someone may *do* once inside is the workspace's own members table, which is
-- authoritative. A role here would be a second answer that can disagree.
--
-- Because it decides nothing, it is allowed to be stale: a leftover row shows a
-- workspace that then denies entry, a missing one hides a workspace still
-- reachable by URL. Both are recoverable and both self-heal on reconcile.
create table workspace_members (
    workspace_id uuid not null,
    user_id      uuid not null,
    created_at   timestamp with time zone default now() not null
);


-- ── Primary keys and unique constraints ──────────────────────────────────────

alter table only users             add constraint users_pkey             primary key (id);
alter table only workspaces        add constraint workspaces_pkey        primary key (id);
alter table only workspace_members add constraint workspace_members_pkey primary key (workspace_id, user_id);

create unique index users_email_lower_key on users using btree (lower(email));
create unique index users_username_lower_key on users using btree (lower(username));

-- Postgres treats nulls as distinct here, so every unnamed workspace coexists.
create unique index workspaces_subdomain_key on workspaces using btree (subdomain);


-- ── Foreign keys ─────────────────────────────────────────────────────────────

alter table only workspaces
    add constraint workspaces_owner_id_fkey foreign key (owner_id) references users(id) on delete restrict;

alter table only workspace_members
    add constraint workspace_members_workspace_id_fkey foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table only workspace_members
    add constraint workspace_members_user_id_fkey foreign key (user_id) references users(id) on delete cascade;


-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Every policy evaluation walks this.
create index workspace_members_user_id_idx on workspace_members using btree (user_id);


-- ── Request identity ─────────────────────────────────────────────────────────

-- Postgres never sees the token; the transaction sets these before its first
-- statement. Unset raises rather than returning null, so an unscoped query fails
-- instead of leaking.
create function public.app_user_id() returns uuid
    language sql stable
    as $$ select current_setting('app.user_id')::uuid $$;

-- SECURITY DEFINER: runs as portal_service, which owns these tables and is
-- therefore not subject to their policies. Without it the workspaces policy
-- would read workspace_members, whose own policy reads workspaces, forever.
-- Empty search_path — a definer function that resolves names through the
-- caller's path is a privilege-escalation hole.
create function public.my_workspace_ids() returns setof uuid
    language sql stable security definer set search_path = ''
    as $$
        select workspace_id
        from public.workspace_members
        where user_id = public.app_user_id()
    $$;

-- Everyone sharing a workspace with the caller, the caller included.
create function public.my_peer_ids() returns setof uuid
    language sql stable security definer set search_path = ''
    as $$
        select distinct user_id
        from public.workspace_members
        where workspace_id in (
            select workspace_id
            from public.workspace_members
            where user_id = public.app_user_id()
        )
        union
        select public.app_user_id()
    $$;


-- ── Row level security ───────────────────────────────────────────────────────
--
-- Not forced: portal_service owns these tables and provisioning writes through
-- it. portal_app owns nothing, so every one of its statements is filtered.
--
-- Creating and destroying workspaces is provisioning work and has no policy at
-- all — portal_app cannot insert into `workspaces` by any route.

alter table users             enable row level security;
alter table workspaces        enable row level security;
alter table workspace_members enable row level security;

create policy users_read on users
    for select using (id in (select public.my_peer_ids()));

create policy users_write_self on users
    for update using (id = public.app_user_id())
             with check (id = public.app_user_id());

create policy workspaces_read on workspaces
    for select using (id in (select public.my_workspace_ids()));

-- Renaming, the subdomain, the plan, destruction: account-level questions, so
-- the account owner answers them. The workspace's own role has no say here, and
-- the index carries none to consult.
create policy workspaces_write on workspaces
    for update using (owner_id = public.app_user_id())
             with check (owner_id = public.app_user_id());

-- Deleting the row is the owner's, and the policy says so. Tearing down the
-- machine and database behind it runs on the fleet credential, which no policy
-- here can reach — which is why the guard settles ownership before any of it.
create policy workspaces_delete on workspaces
    for delete using (owner_id = public.app_user_id());

create policy members_read on workspace_members
    for select using (workspace_id in (select public.my_workspace_ids()));

-- No write policy: the index is maintained by provisioning and the reconciler,
-- both of which run as portal_service.


-- ── Grants ───────────────────────────────────────────────────────────────────
--
-- RLS decides which rows. Column grants decide which fields — a user may rename
-- themselves but not rewrite the email the issuer gave them, and an owner may
-- rename a workspace and set its subdomain, but not change its plan or status.

grant usage on schema public to portal_app;

grant select on users to portal_app;
grant update (username, display_name, avatar_url) on users to portal_app;

grant select, delete on workspaces to portal_app;
grant update (display_name, subdomain) on workspaces to portal_app;

-- Read only: nothing user-facing writes the index.
grant select on workspace_members to portal_app;


-- ── Triggers ─────────────────────────────────────────────────────────────────

create function set_updated_at() returns trigger
    language plpgsql
    as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger users_set_updated_at      before update on users      for each row execute function set_updated_at();
create trigger workspaces_set_updated_at before update on workspaces for each row execute function set_updated_at();

-- Every Stripe event that has been acted on. Stripe retries until it gets a
-- 2xx, so the same event arrives more than once; acting twice would rebuild a
-- running workspace for nothing.
create table stripe_events (
    id          text not null,
    received_at timestamp with time zone default now() not null,

    constraint stripe_events_pkey primary key (id)
);

-- One row per listing: the owner's current active publication, verbatim and
-- uninterpreted, under an id minted here. Going private deletes the row.
create table listings (
    -- Minted by Listing.createId: a fixed first group marks listing ids.
    id                   uuid not null,
    workspace_id         uuid not null,
    publication_meta     jsonb not null,
    workflow_data        jsonb not null,
    -- Non-null puts the listing on the extended shelf, under this blueprint id.
    blueprint_id         text,
    created_at           timestamp with time zone default now() not null,
    updated_at           timestamp with time zone default now() not null,

    constraint listings_pkey primary key (id),
    constraint listings_blueprint_id_key unique (blueprint_id),
    constraint listings_workspace_id_fkey foreign key (workspace_id) references workspaces(id) on delete cascade
);

create index listings_workspace_id_idx on listings (workspace_id);

create trigger listings_set_updated_at before update on listings for each row execute function set_updated_at();

-- Set by asSilo the way app.user_id is set by asUser. Unset raises.
create function public.app_workspace_id() returns uuid
    language sql stable
    as $$ select current_setting('app.workspace_id')::uuid $$;

-- Anyone reads; only the owning workspace writes. portal_service bypasses these.
alter table listings enable row level security;

create policy listings_read   on listings for select using (true);
create policy listings_insert on listings for insert with check (workspace_id = public.app_workspace_id());
create policy listings_update on listings for update using (workspace_id = public.app_workspace_id())
                                              with check (workspace_id = public.app_workspace_id());
create policy listings_delete on listings for delete using (workspace_id = public.app_workspace_id());

grant select, insert, update, delete on listings to portal_app;
