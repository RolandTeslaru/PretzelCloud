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
-- Ownership of a workspace is a `workspace_members` row with role 'owner'.
-- There is no owner column: a second authority source is a second thing to keep
-- in sync, and the two only ever disagree at the worst moment. `created_by` is
-- attribution, nullable, and never read by a policy.

-- One row per subject of the fleet issuer. Identity lives at the issuer; this
-- is the profile the portal renders.
create table users (
    id           uuid not null,
    email        text not null,
    display_name text not null,
    avatar_url   text,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null
);

-- `status` is the provisioning lifecycle. A workspace that never reaches 'ready'
-- is torn down and its row deleted, so the user simply retries; 'failed' is set
-- only when teardown itself failed and the reconciler still has work to do.
create table workspaces (
    id           uuid not null,
    slug         text not null,
    display_name text not null,
    status       text default 'provisioning' not null,
    plan         text default 'free' not null,
    created_by   uuid,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint workspaces_status_check check (status in ('provisioning', 'ready', 'suspended', 'failed')),
    constraint workspaces_plan_check   check (plan in ('free', 'pro'))
);

-- The user x workspace access index. The workspace's own database holds a
-- `members` table saying the same thing; those are separate databases and can
-- drift, which the invitation flow has to reconcile.
create table workspace_members (
    workspace_id uuid not null,
    user_id      uuid not null,
    role         text not null,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'))
);

-- An invitee is by definition not yet a member, so this table's read policy
-- keys off the invited address rather than membership.
create table invitations (
    id           uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    email        text not null,
    role         text not null,
    token_hash   text not null,
    invited_by   uuid,
    expires_at   timestamp with time zone not null,
    accepted_at  timestamp with time zone,
    created_at   timestamp with time zone default now() not null,

    constraint invitations_role_check check (role in ('admin', 'member'))
);


-- ── Primary keys and unique constraints ──────────────────────────────────────

alter table only users             add constraint users_pkey             primary key (id);
alter table only workspaces        add constraint workspaces_pkey        primary key (id);
alter table only workspace_members add constraint workspace_members_pkey primary key (workspace_id, user_id);
alter table only invitations       add constraint invitations_pkey       primary key (id);

create unique index users_email_lower_key on users using btree (lower(email));
create unique index workspaces_slug_key   on workspaces using btree (slug);

-- One live invitation per address per workspace.
create unique index invitations_pending_key on invitations using btree (workspace_id, lower(email)) where (accepted_at is null);


-- ── Foreign keys ─────────────────────────────────────────────────────────────

alter table only workspaces
    add constraint workspaces_created_by_fkey foreign key (created_by) references users(id) on delete set null;

alter table only workspace_members
    add constraint workspace_members_workspace_id_fkey foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table only workspace_members
    add constraint workspace_members_user_id_fkey foreign key (user_id) references users(id) on delete cascade;

alter table only invitations
    add constraint invitations_workspace_id_fkey foreign key (workspace_id) references workspaces(id) on delete cascade;

alter table only invitations
    add constraint invitations_invited_by_fkey foreign key (invited_by) references users(id) on delete set null;


-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Every policy evaluation walks this.
create index workspace_members_user_id_idx on workspace_members using btree (user_id);

create index invitations_email_idx on invitations using btree (lower(email));


-- ── Request identity ─────────────────────────────────────────────────────────

-- Postgres never sees the token; the transaction sets these before its first
-- statement. Unset raises rather than returning null, so an unscoped query fails
-- instead of leaking.
create function public.app_user_id() returns uuid
    language sql stable
    as $$ select current_setting('app.user_id')::uuid $$;

create function public.app_user_email() returns text
    language sql stable
    as $$ select current_setting('app.user_email') $$;

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

create function public.my_admin_workspace_ids() returns setof uuid
    language sql stable security definer set search_path = ''
    as $$
        select workspace_id
        from public.workspace_members
        where user_id = public.app_user_id()
          and role in ('owner', 'admin')
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
alter table invitations       enable row level security;

create policy users_read on users
    for select using (id in (select public.my_peer_ids()));

create policy users_write_self on users
    for update using (id = public.app_user_id())
             with check (id = public.app_user_id());

create policy workspaces_read on workspaces
    for select using (id in (select public.my_workspace_ids()));

create policy workspaces_write on workspaces
    for update using (id in (select public.my_admin_workspace_ids()))
             with check (id in (select public.my_admin_workspace_ids()));

create policy members_read on workspace_members
    for select using (workspace_id in (select public.my_workspace_ids()));

create policy members_write on workspace_members
    for all using (workspace_id in (select public.my_admin_workspace_ids()))
            with check (workspace_id in (select public.my_admin_workspace_ids()));

create policy invitations_read on invitations
    for select using (
        workspace_id in (select public.my_admin_workspace_ids())
        or lower(email) = lower(public.app_user_email())
    );

create policy invitations_write on invitations
    for all using (workspace_id in (select public.my_admin_workspace_ids()))
            with check (workspace_id in (select public.my_admin_workspace_ids()));


-- ── Grants ───────────────────────────────────────────────────────────────────
--
-- RLS decides which rows. Column grants decide which fields — a user may rename
-- themselves but not rewrite the email the issuer gave them, and an admin may
-- rename a workspace but not change its slug, plan or status.

grant usage on schema public to portal_app;

grant select on users to portal_app;
grant update (display_name, avatar_url) on users to portal_app;

grant select on workspaces to portal_app;
grant update (display_name) on workspaces to portal_app;

grant select, delete on workspace_members to portal_app;
grant insert (workspace_id, user_id, role) on workspace_members to portal_app;
grant update (role) on workspace_members to portal_app;

grant select, delete on invitations to portal_app;
grant insert (workspace_id, email, role, token_hash, invited_by, expires_at) on invitations to portal_app;
grant update (accepted_at) on invitations to portal_app;


-- ── Triggers ─────────────────────────────────────────────────────────────────

create function set_updated_at() returns trigger
    language plpgsql
    as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger users_set_updated_at             before update on users             for each row execute function set_updated_at();
create trigger workspaces_set_updated_at        before update on workspaces        for each row execute function set_updated_at();
create trigger workspace_members_set_updated_at before update on workspace_members for each row execute function set_updated_at();
