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
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null
);

-- `status` is the provisioning lifecycle. A workspace that never reaches 'ready'
-- is torn down and its row deleted, so the user simply retries; 'failed' is set
-- only when teardown itself failed and the reconciler still has work to do.
-- `subdomain` is the *custom* hostname label, and only paid plans set one. Every
-- workspace also answers at a canonical label derived from its id, which is not
-- stored: deriving it means it cannot drift from the id, cannot be edited, and
-- survives a custom name changing — so a webhook URL never breaks.
create table workspaces (
    id           uuid not null,
    subdomain    text,
    display_name text not null,
    status       text default 'provisioning' not null,
    plan         text default 'free' not null,
    owner_id     uuid not null,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint workspaces_status_check check (status in ('provisioning', 'ready', 'suspended', 'failed')),
    constraint workspaces_plan_check   check (plan in ('free', 'starter', 'pro'))
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
