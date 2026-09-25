import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Listing, User, Workspace } from '@pretzel-cloud/shared/domain';
import { WorkspaceDB } from '@/db/workspace';

type Trx = WorkspaceDB.Transaction;

/** The same workspace and listing always name the same workflow, so a re-run finds its earlier copy. */
const getStarterWorkflowId = (workspaceId: Workspace.Id, listingId: Listing.Id): string => {
    const digest = createHash('sha1').update(`${workspaceId}:${listingId}`).digest('hex');

    // Laid out as a version 5 uuid, which is what a name-derived id is.
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
};

/** What a listing published about its workflow, as far as a copy reuses it. */
const getStarterMeta = (listing: Listing) => {
    const meta = (listing.publicationMeta.workflow_meta ?? {}) as Record<string, unknown>;

    const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

    return {
        displayName: text(meta.display_name) ?? 'Starter workflow',
        description: text(meta.description),
        icon:        text(meta.icon),
        accent:      text(meta.accent),
        iconColor:   text(meta.icon_color),
    };
};

/** Writes the fleet makes inside a workspace's own tables. */
@Injectable()
export class SiloDatabase {

    /** Membership and API keys cascade; shared content keeps its rows with blank attribution. */
    public async deleteUser(trx: Trx, userId: User.Id): Promise<void> {
        await trx.deleteFrom('users').where('id', '=', userId).execute();
    }

    /** Idempotent. Refuses a second owner rather than adding one. */
    public async seedOwner(trx: Trx, owner: User): Promise<void> {
        // Locked, so a concurrent seed waits rather than writing a second owner.
        const claim = await trx
            .selectFrom('workspace')
            .select('claimed_by')
            .forUpdate()
            .executeTakeFirst();

        const holder = claim?.claimed_by ?? null;

        if (holder && holder !== owner.id)
            throw new Error(`This workspace is already owned by ${holder}`);

        // Before the rows that reference it. The profile refreshes on a re-run.
        await trx
            .insertInto('users')
            .values({
                id:           owner.id,
                email:        owner.email,
                username:     owner.username,
                display_name: owner.displayName,
                avatar_url:   owner.avatarUrl,
            })
            .onConflict((oc) => oc.column('id').doUpdateSet({
                email:        owner.email,
                username:     owner.username,
                display_name: owner.displayName,
                avatar_url:   owner.avatarUrl,
            }))
            .execute();

        await trx
            .insertInto('members')
            .values({ user_id: owner.id, role: 'owner' })
            .onConflict((oc) => oc.column('user_id').doNothing())
            .execute();

        // Leaves the original timestamp alone on a re-run.
        await trx
            .updateTable('workspace')
            .set({ claimed_by: owner.id, claimed_at: new Date() })
            .where('claimed_at', 'is', null)
            .execute();
    }




    /** Idempotent. Copies each listing into the root folder as the owner's workflow. */
    public async seedStarters(trx: Trx, workspaceId: Workspace.Id, owner: User, starters: Listing[]): Promise<void> {
        if (starters.length === 0)
            return;

        await trx
            .insertInto('workflows')
            .values(starters.map((listing) => {
                const meta = getStarterMeta(listing);

                return {
                    id:           getStarterWorkflowId(workspaceId, listing.id),
                    display_name: meta.displayName,
                    description:  meta.description,
                    icon:         meta.icon,
                    accent:       meta.accent,
                    icon_color:   meta.iconColor,
                    data:         listing.workflowData,
                    folder_id:    WorkspaceDB.Workflow.ROOT_FOLDER_ID,
                    created_by:   owner.id,
                };
            }))
            .onConflict((oc) => oc.column('id').doNothing())
            .execute();
    }
}
