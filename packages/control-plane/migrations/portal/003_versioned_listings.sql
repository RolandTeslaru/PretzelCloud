-- A listing keeps one version per PretzelGraph release step; `listings` becomes the identity
-- consumers embed, and the extended shelf's blueprint ids move to a table only the operator writes.

create table listing_versions (
    listing_id       uuid not null,
    version          integer not null,
    publication_id   uuid not null,
    publication_meta jsonb not null,
    workflow_data    jsonb not null,
    release          text not null,
    -- Dotted integers compare as versions; build metadata after + is dropped.
    release_order    integer[] generated always as (string_to_array(split_part(release, '+', 1), '.')::integer[]) stored,
    published_at     timestamp with time zone default now() not null,

    constraint listing_versions_pkey primary key (listing_id, version),
    constraint listing_versions_listing_id_release_order_key unique (listing_id, release_order),
    constraint listing_versions_listing_id_fkey foreign key (listing_id) references listings(id) on delete cascade
);

create table extended_shelf (
    listing_id   uuid not null,
    blueprint_id text not null,

    constraint extended_shelf_pkey primary key (listing_id),
    constraint extended_shelf_blueprint_id_key unique (blueprint_id),
    constraint extended_shelf_listing_id_fkey foreign key (listing_id) references listings(id) on delete cascade
);

-- Every existing listing becomes version 1, runnable on every release as it is today.
insert into listing_versions (listing_id, version, publication_id, publication_meta, workflow_data, release, published_at)
select id, 1, (publication_meta ->> 'id')::uuid, publication_meta, workflow_data, '0.0.0', updated_at
from listings;

insert into extended_shelf (listing_id, blueprint_id)
select id, blueprint_id
from listings
where blueprint_id is not null;

drop trigger listings_set_updated_at on listings;

alter table listings
    drop column publication_meta,
    drop column workflow_data,
    drop column blueprint_id,
    drop column updated_at,
    add column withdrawn_at timestamp with time zone;

-- Anyone reads; the owning workspace writes its own listing's versions. portal_service bypasses these.
alter table listing_versions enable row level security;

create policy listing_versions_read   on listing_versions for select using (true);
create policy listing_versions_insert on listing_versions for insert
    with check (exists (select 1 from listings where listings.id = listing_id and listings.workspace_id = public.app_workspace_id()));
create policy listing_versions_delete on listing_versions for delete
    using (exists (select 1 from listings where listings.id = listing_id and listings.workspace_id = public.app_workspace_id()));

grant select, insert, delete on listing_versions to portal_app;

-- Anyone reads; only portal_service writes.
alter table extended_shelf enable row level security;

create policy extended_shelf_read on extended_shelf for select using (true);

grant select on extended_shelf to portal_app;
