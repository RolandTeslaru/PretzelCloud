-- Listings an admin offers as starting points for a new workflow. Category ids name the
-- gallery categories PretzelGraph defines; an id a release does not know is ignored there.

create table templates (
    listing_id   uuid not null,
    sort_order   integer default 0 not null,
    category_ids text[] default '{}' not null,

    constraint templates_pkey primary key (listing_id),
    constraint templates_listing_id_fkey foreign key (listing_id) references listings(id) on delete cascade
);

-- Anyone reads; only portal_service writes.
alter table templates enable row level security;

create policy templates_read on templates for select using (true);

grant select on templates to portal_app;
