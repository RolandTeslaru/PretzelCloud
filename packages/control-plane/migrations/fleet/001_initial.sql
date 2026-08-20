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
create table workspace_secrets (
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
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null
);

create table machines (
    id           uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    driver       text not null,
    external_id  text not null,
    role         text not null,
    size         text not null,
    state        text default 'creating' not null,
    last_boot_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at   timestamp with time zone default now() not null,
    updated_at   timestamp with time zone default now() not null,

    constraint machines_driver_check check (driver in ('docker', 'fly')),
    constraint machines_role_check   check (role in ('backend', 'worker', 'combined')),
    constraint machines_state_check  check (state in ('creating', 'started', 'stopped', 'destroyed'))
);

create table hostnames (
    host         text not null,
    workspace_id uuid not null,
    kind         text not null,
    created_at   timestamp with time zone default now() not null,

    constraint hostnames_kind_check check (kind in ('app', 'hooks'))
);

-- What the router needs beyond machine state, reported by the workspace itself.
create table workspace_runtime (
    workspace_id     uuid not null,
    has_publications boolean default false not null,
    reported_at      timestamp with time zone
);


-- ── Primary keys and unique constraints ──────────────────────────────────────

alter table only workspace_secrets add constraint workspace_secrets_pkey primary key (workspace_id);
alter table only machines          add constraint machines_pkey          primary key (id);
alter table only hostnames         add constraint hostnames_pkey         primary key (host);
alter table only workspace_runtime add constraint workspace_runtime_pkey primary key (workspace_id);

-- A workspace has one machine per role. A re-run collides here instead of
-- creating a second machine nobody is tracking.
create unique index machines_workspace_role_key on machines using btree (workspace_id, role);

-- No uniqueness on (workspace_id, kind): a workspace answers at its canonical
-- host and, on paid plans, an additional custom one. A host still resolves to
-- exactly one workspace — that is the primary key.

create unique index machines_driver_external_key on machines using btree (driver, external_id);


-- ── Indexes ──────────────────────────────────────────────────────────────────

create index machines_workspace_id_idx  on machines  using btree (workspace_id);
create index hostnames_workspace_id_idx on hostnames using btree (workspace_id);

-- The reconciler's sweep, and the router's cold-start check.
create index machines_state_idx on machines using btree (state);


-- ── Triggers ─────────────────────────────────────────────────────────────────

create function set_updated_at() returns trigger
    language plpgsql
    as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger workspace_secrets_set_updated_at before update on workspace_secrets for each row execute function set_updated_at();
create trigger machines_set_updated_at          before update on machines          for each row execute function set_updated_at();
