#!/bin/sh
# Runs once, on an empty data volume.
#
# One cluster plays three parts here: the control plane's two databases, the
# auth service's own, and the cluster that workspace databases get created in
# later. In production those are separate hosts; they are only databases.
#
# The roles are created here rather than in a migration because they carry
# passwords. Migrations assume they exist and grant against them.
set -e

GOTRUE_DB="${GOTRUE_DB_NAME:-gotrue}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    create role portal_service login password '${PORTAL_SERVICE_PASSWORD:-service}';
    create role portal_app     login password '${PORTAL_APP_PASSWORD:-app}';
    create role fleet_service   login password '${FLEET_SERVICE_PASSWORD:-service}';

    create database portal owner portal_service;
    create database fleet  owner fleet_service;

    create database "${GOTRUE_DB}";

    -- The portal and fleet databases revoke this in their own migrations; the
    -- auth service has none of ours, so it happens here. Password hashes should
    -- refuse a connection, not merely refuse a query.
    revoke connect on database "${GOTRUE_DB}" from public;
EOSQL

# The auth service expects its schema to already exist, and resolves unqualified
# names through search_path — without this its enum types land in public.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$GOTRUE_DB" <<-EOSQL
    create schema if not exists auth authorization "${POSTGRES_USER}";
EOSQL
