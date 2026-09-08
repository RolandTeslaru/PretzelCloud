-- A listing is addressed by its owner and the owner's workflow id.
alter table listings add column workflow_id uuid;

update listings set workflow_id = (publication_meta ->> 'workflow_id')::uuid;

alter table listings alter column workflow_id set not null;

alter table listings add constraint listings_workspace_id_workflow_id_key unique (workspace_id, workflow_id);

-- Covered by the unique index's leading column.
drop index listings_workspace_id_idx;
