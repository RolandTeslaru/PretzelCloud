#!/usr/bin/env bash
#
# Prepares a fresh cluster to hold the control plane's databases. What compose
# does once on an empty volume, for a cluster nobody has touched.
#
#   bash scripts/setup-control-plane-cluster.sh 'postgres://owner:pw@host/db?sslmode=require'
#
# Creates nothing a migration would: the tables are the control plane's own to
# build, and it does that at boot. This makes the databases and the roles that
# own them, because roles carry passwords and migrations assume they exist.
#
# Reads PORTAL_SERVICE_PASSWORD, PORTAL_APP_PASSWORD, FLEET_SERVICE_PASSWORD and
# GOTRUE_SERVICE_PASSWORD from the environment; refuses to invent them.

set -euo pipefail

ADMIN_URL="${1:-}"

[ -n "$ADMIN_URL" ] || { echo "Pass the cluster's admin connection URL" >&2; exit 1; }

for name in PORTAL_SERVICE_PASSWORD PORTAL_APP_PASSWORD FLEET_SERVICE_PASSWORD GOTRUE_SERVICE_PASSWORD; do
    [ -n "${!name:-}" ] || { echo "$name is not set" >&2; exit 1; }
done

GOTRUE_DB="${GOTRUE_DB_NAME:-gotrue}"

# Roles first: a database is created owned by one.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'portal_service') then
        create role portal_service login password '${PORTAL_SERVICE_PASSWORD}';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'portal_app') then
        create role portal_app login password '${PORTAL_APP_PASSWORD}';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'fleet_service') then
        create role fleet_service login password '${FLEET_SERVICE_PASSWORD}';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'gotrue_service') then
        create role gotrue_service login password '${GOTRUE_SERVICE_PASSWORD}';
    end if;

    -- The auth service's migrations grant table access to a role named
    -- "postgres", which a managed cluster does not necessarily have.
    if not exists (select 1 from pg_roles where rolname = 'postgres') then
        create role postgres nologin;
    end if;
end \$\$;

-- Creating a database owned by a role requires membership in it; an admin that
-- is not superuser (Neon, RDS) does not have it implicitly.
grant portal_service, fleet_service, gotrue_service to current_user;
SQL

# Outside a transaction: create database refuses to run in one.
create_database() {
    local name=$1 owner=$2

    if psql "$ADMIN_URL" -tAc "select 1 from pg_database where datname = '$name'" | grep -q 1; then
        echo "  $name exists"
        return
    fi

    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "create database \"$name\" owner \"$owner\""
    echo "  $name created"
}

create_database portal portal_service
create_database fleet  fleet_service
create_database "$GOTRUE_DB" gotrue_service

# A password hash should refuse a connection, not merely refuse a query.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
    -c "revoke connect on database portal from public" \
    -c "revoke connect on database fleet from public" \
    -c "revoke connect on database \"$GOTRUE_DB\" from public" \
    -c "grant connect on database portal to portal_service, portal_app" \
    -c "grant connect on database fleet to fleet_service" \
    -c "grant connect on database \"$GOTRUE_DB\" to gotrue_service" >/dev/null

# The auth service resolves unqualified names through search_path, and the one
# in its connection URL is not honoured everywhere — without the role-level
# setting its enum types land in public while its tables land in auth.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
    -c "alter role gotrue_service in database \"$GOTRUE_DB\" set search_path = auth, public" >/dev/null

GOTRUE_URL="$(echo "$ADMIN_URL" | sed -E "s|//[^@]*@|//gotrue_service:${GOTRUE_SERVICE_PASSWORD}@|; s|/[^/?]+(\?\|$)|/${GOTRUE_DB}\1|")"

psql "$GOTRUE_URL" -v ON_ERROR_STOP=1 -c "create schema if not exists auth authorization gotrue_service" >/dev/null

echo
echo "Ready. The control plane builds its own tables on first boot."
