import { Injectable } from '@nestjs/common';
import { User } from '@pretzel-cloud/shared/domain';
import { WorkspaceDB } from '@/db/workspace';

type Trx = WorkspaceDB.Transaction;

/** Writes the fleet makes inside a workspace's own tables. */
@Injectable()
export class SiloDatabase {

    /** Idempotent. Refuses a second owner rather than adding one. */
    public async seedOwner(trx: Trx, owner: User): Promise<void> {
        // Locked, so a concurrent seed waits rather than writing a second owner.
        const deployment = await trx
            .selectFrom('deployment')
            .select('claimed_by')
            .forUpdate()
            .executeTakeFirst();

        const holder = deployment?.claimed_by ?? null;

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
            .updateTable('deployment')
            .set({ claimed_by: owner.id, claimed_at: new Date() })
            .where('claimed_at', 'is', null)
            .execute();
    }
}
