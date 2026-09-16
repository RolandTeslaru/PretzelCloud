import { Button } from '@pretzel-graph/standard-ui/foundations'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'

export const DangerSettings = ({ workspaceId }: { workspaceId: Workspace.Id; dialogId: string }) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    if (!workspace) return null

    return (
        <div className="flex flex-col gap-3 pr-2">
            <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Destroy this workspace</p>
                    <p className="text-muted-foreground text-xs">
                        The machine is torn down and the database dropped. Nothing is recoverable
                        afterwards.
                    </p>
                </div>

                <Button variant="destructive" size="sm" className="mr-auto" onClick={() => WorkspaceSDK.dialogs.openDestroy(workspaceId)}>
                    Destroy workspace
                </Button>
            </div>
        </div>
    )
}
