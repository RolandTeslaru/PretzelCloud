import { Admin } from '@pretzel-cloud/shared/domain'
import { Button, DropdownMenu } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { AdminSDK } from '../sdk'

export const AdminWorkspaceActions = ({ summary, onDeleted }: {
    summary: Admin.WorkspaceSummary
    onDeleted?: () => void
}) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${summary.workspace.displayName} owned by ${summary.owner.email}`}>
                <SystemIcons.Ellipsis size={16} />
            </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
            <DropdownMenu.Item variant="destructive" onSelect={() => AdminSDK.openDeleteWorkspaceDialog(summary, onDeleted)}>
                <SystemIcons.Trash2 size={14} /> Delete workspace
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Root>
)
