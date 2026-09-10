-- Fleet: regions on clusters and hardware.
--
-- Run by hand against a fleet database that predates the region columns in
-- migrations/fleet/001_initial.sql. Fresh installs get all of this from the
-- migration itself; this file exists so an existing fleet can catch up.
--
-- Idempotent: every step checks for itself, so a second run is a no-op.
-- Run as the fleet owner (fleet_service), in the fleet database.

-- Dev clusters were seeded as 'local'; the only value the fleet knows is the product region.
update clusters set region = 'us-east-1' where region = 'local';

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'clusters_region_check') then
        alter table clusters add constraint clusters_region_check check (region in ('us-east-1', 'eu-central-1'));
    end if;

    -- What hardware points at, so a workspace's machines cannot land away from its database.
    if not exists (select 1 from pg_constraint where conname = 'clusters_id_region_key') then
        alter table clusters add constraint clusters_id_region_key unique (id, region);
    end if;
end $$;

-- The cluster's region, repeated on hardware so the FK below can insist they match.
alter table hardware add column if not exists region text;

update hardware h set region = c.region from clusters c where c.id = h.cluster_id and h.region is null;

alter table hardware alter column region set not null;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'hardware_region_check') then
        alter table hardware add constraint hardware_region_check check (region in ('us-east-1', 'eu-central-1'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'hardware_cluster_region_fkey') then
        alter table hardware add constraint hardware_cluster_region_fkey foreign key (cluster_id, region) references clusters(id, region);
    end if;
end $$;
