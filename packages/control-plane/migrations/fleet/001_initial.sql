-- 001_initial — the fleet database.
--
-- Living document until launch: schema changes are edits to this file, not new
-- numbered migrations.
--
-- What has actually been materialized for a workspace: its connection string,
-- its key material, its machines, its hostnames. Desired state lives in the
-- portal database, on a different credential, and this one never reads it.
--
-- One role, created by the bootstrap script:
--
--   fleet_service  owns everything here. No second role, no RLS, no policies —
--                  there is no user-facing zone in this database, and no
--                  process that holds this credential serves a browser.
--
-- Postgres grants CONNECT on every database to PUBLIC, so the first act is to
-- take it back. The owner keeps it implicitly; nobody else gets it. This is the
-- credential boundary the whole split rests on.
do $$
begin
    execute format('revoke connect on database %I from public', current_database());
end
$$;

-- `workspace_id` is a plain uuid. There is no foreign key to `workspaces`: it
-- lives in another database. So rows here can outlive the workspace they name,
-- and a workspace can exist with nothing here yet. Both are expected states
-- during provisioning and both are the reconciler's job:
--
--   rows with no workspace   → destroy the machine, drop the database, delete
--   workspace with no rows   → finish provisioning, or tear down past the deadline
--
-- Provisioning writes in a fixed order and every step is idempotent, so a run
-- killed halfway can be re-run under the same workspace id and will no-op until
-- it reaches the step that did not finish. That is what the unique constraints
-- below are for — not data hygiene, but re-runnability.

-- Read by exactly one caller: the provisioner, handing these values to a
-- machine as secrets. Never returned to a controller, never logged.
-- No key id column: it is the key's own fingerprint, so the workspace derives it
-- from the key it already holds. Storing it would be a second copy of a fact the
-- key already carries, and one that can be edited into disagreeing.
create table silo_secrets (
    workspace_id uuid not null,
    database_url text not null,
    encryption_key text not null,
    -- Signs the tokens a running execution presents back to its own backend.
    -- Per workspace: a fleet-wide value would let one workspace mint another's.
    execution_token_signing_key text not null,
    -- Stamped by the router on forwarded traffic and required by the silo.
    -- Per workspace: a fleet-wide value would let one silo impersonate the
    -- router to another.
    router_secret text not null,
    -- Shared by a split's backend and worker, so it cannot be per-container.
    internal_token text not null,
    redis_password text not null,
    -- The backend's own credential for calling the control plane. Never given to
    -- the worker: that machine runs workflow code.
    cloud_token text not null,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null
);

-- A workspace's compute. One row per workspace (the unique index enforces the
-- 1:1); its machines hold the FK back. `driver` lives here, not on the machine:
-- a workspace never mixes substrates.
-- The Postgres clusters workspace databases are created in. A workspace's own
-- database name is derived from its id, so the cluster is the only part of its
-- address that has to be recorded.
create table clusters (
    id         uuid default gen_random_uuid() not null,
    -- Spoken names, so an operator can say which one without reading a uuid.
    name       text not null,
    -- What a machine connects to. The admin credential is not held here.
    host       text not null,
    port       integer not null default 5432,
    -- Whether connections must use TLS. On for clusters reached over the open internet.
    ssl        boolean not null default false,
    region     text not null,
    -- Whether new workspaces may be placed here. Draining is flipping this off.
    accepting  boolean not null default true,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- One to begin with, addressed as the compose service is. A deployment updates
-- the row rather than editing this: the host differs per environment, and its
-- admin credential is read from CLUSTER_ADMIN_URL_ALPHA either way.
insert into clusters (name, host, port, region) values ('alpha', 'postgres-alpha', 5432, 'local');

create table hardware (
    id           uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    driver       text not null,
    cluster_id   uuid not null,
    last_boot_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint hardware_driver_check check (driver in ('docker', 'fly')),
    -- What the machines below point at, so the two cannot disagree.
    constraint hardware_id_driver_key unique (id, driver)
);

create table machines (
    id           uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    -- The hardware this machine backs, created before it.
    hardware_id  uuid not null,
    -- Copied from that hardware so acting on a machine needs no second read. The
    -- composite key below refuses a row whose driver disagrees with it.
    driver       text not null,
    external_id  text not null,
    role         text not null,
    size         text not null,
    state        text default 'creating' not null,
    last_boot_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint machines_role_check   check (role in ('backend', 'worker', 'combined')),
    constraint machines_state_check  check (state in ('creating', 'running', 'suspended', 'stopped', 'destroyed'))
);

create table hostnames (
    host         text not null,
    workspace_id uuid not null,
    kind         text not null,
    created_at   timestamp with time zone default now() not null,

    constraint hostnames_kind_check check (kind in ('app', 'hooks'))
);

-- What the router needs beyond machine state, reported by the workspace itself.
-- ── Primary keys and unique constraints ──────────────────────────────────────

alter table only silo_secrets add constraint silo_secrets_pkey primary key (workspace_id);
alter table only clusters          add constraint clusters_pkey          primary key (id);
alter table only clusters          add constraint clusters_name_key      unique (name);
alter table only hardware          add constraint hardware_pkey          primary key (id);
alter table only machines          add constraint machines_pkey          primary key (id);
alter table only hostnames         add constraint hostnames_pkey         primary key (host);

-- A workspace has one machine per role. A re-run collides here instead of
-- creating a second machine nobody is tracking.
create unique index hardware_workspace_key on hardware using btree (workspace_id);
create unique index machines_workspace_role_key on machines using btree (workspace_id, role);
alter table only machines add constraint machines_hardware_driver_fkey foreign key (hardware_id, driver) references hardware(id, driver) on delete cascade;

-- Restrict, not cascade: a cluster with workspaces on it cannot be removed
-- while their databases are still there.
alter table only hardware add constraint hardware_cluster_fkey foreign key (cluster_id) references clusters(id) on delete restrict;

-- No uniqueness on (workspace_id, kind): a workspace answers at its canonical
-- host and, on paid plans, an additional custom one. A host still resolves to
-- exactly one workspace — that is the primary key.

create unique index machines_external_key on machines using btree (external_id);


-- ── Indexes ──────────────────────────────────────────────────────────────────

create index machines_workspace_id_idx  on machines  using btree (workspace_id);
create index hostnames_workspace_id_idx on hostnames using btree (workspace_id);

-- The reconciler's sweep, and the router's cold-start check.
create index machines_state_idx on machines using btree (state);


-- ── Usage ────────────────────────────────────────────────────────────────────

-- One row per execution a workspace reported creating. Here rather than in the
-- workspace's own database, which belongs to its customer.
create table workspace_usage (
    id           uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    -- The execution in the workspace's own database. Nothing can reference it:
    -- that database is not this one. Null when the response was unreadable.
    execution_id uuid,
    -- What set it off, as the workspace reported it.
    igniter      text,
    created_at   timestamp with time zone default now() not null,

    constraint workspace_usage_pkey primary key (id)
);

-- A client retrying a run with the same minted id must not count twice.
create unique index workspace_usage_execution_key
    on workspace_usage using btree (workspace_id, execution_id)
    where execution_id is not null;

-- Counting a month, and listing one workspace's runs newest first.
create index workspace_usage_workspace_created_idx
    on workspace_usage using btree (workspace_id, created_at desc);


-- ── Triggers ─────────────────────────────────────────────────────────────────

create function set_updated_at() returns trigger
    language plpgsql
    as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger silo_secrets_set_updated_at before update on silo_secrets for each row execute function set_updated_at();
create trigger machines_set_updated_at          before update on machines          for each row execute function set_updated_at();
