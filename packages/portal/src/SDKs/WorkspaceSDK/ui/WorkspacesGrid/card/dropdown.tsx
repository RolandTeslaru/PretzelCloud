import { Button, DropdownMenu } from '@pretzel-graph/standard-ui/foundations'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { NotificationSDK } from '@pretzel-graph/standard-ui/SDKs/NotificationSDK'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../../sdk'


const copyWorkspaceId = async (id: Workspace.Id) => {
    try {
        await navigator.clipboard.writeText(id)

        NotificationSDK.toast.success('Workspace ID copied')
    }
    catch {
        NotificationSDK.toast.error('Could not reach the clipboard')
    }
}


/** The card's overflow menu. */
export const CardDropdown = ({ workspaceId }: { workspaceId: Workspace.Id }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
            <Button size="icon-xs" variant="ghost">
                <SystemIcons.Ellipsis />
            </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align='start' side="right">
            <DropdownMenu.Item
                className='gap-2 text-xs'
                onClick={() => copyWorkspaceId(workspaceId)}
            >
                <SystemIcons.Copy />
                Copy Workspace ID
            </DropdownMenu.Item>
            <DropdownMenu.Item
                className='gap-2 text-xs'
                onClick={() => WorkspaceSDK.openConfigurationDialog(workspaceId)}
            >
                <SystemIcons.Settings />
                Open Configuration
            </DropdownMenu.Item>
            <DropdownMenu.Item
                className='gap-2 text-xs'
                onClick={() => WorkspaceSDK.openConfigurationDialog(workspaceId, 'plan')}
            >
                <SystemIcons.Sparkles />
                Upgrade
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Root>
)
