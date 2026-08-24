import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { Illustrations, SystemIcons } from '@pretzel-graph/standard-ui/icons'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'
import { GeneralSettings } from './GeneralSettings'
import { DomainSettings } from './DomainSettings'
import { DangerSettings } from './DangerSettings'
import { LifecycleSettings } from './LifecycleSettings'
import { PlanSettings } from './PlanSettings'

export type ItemId = 'general' | 'domain' | 'plan' | 'lifecycle' | 'danger'

type PanelProps = { workspaceId: Workspace.Id; dialogId: string }

const WorkspaceConfiguration = ({ workspaceId, dialogId, currentPanel, ...templateProps }: PanelProps & { currentPanel?: ItemId } & DialogSDK.TemplateProps) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const panelProps = { workspaceId, dialogId }

    const items: DialogSDK.TabsTemplate.Item[] = [
        { id: 'general',   label: 'General',     icon: SystemIcons.Settings,      panel: <GeneralSettings {...panelProps} /> },
        { id: 'domain',    label: 'Domain',      icon: SystemIcons.Globe,         panel: <DomainSettings {...panelProps} /> },
        { id: 'plan',      label: 'Plan',        icon: SystemIcons.Receipt,       panel: <PlanSettings {...panelProps} /> },
        { id: 'lifecycle', label: 'Lifecycle',   icon: SystemIcons.Power,         panel: <LifecycleSettings {...panelProps} /> },
        { id: 'danger',    label: 'Danger zone', icon: SystemIcons.AlertTriangle, panel: <DangerSettings {...panelProps} />, tone: 'destructive' },
    ]

    return (
        <DialogSDK.TabsTemplate
            {...templateProps}
            className='sm:max-w-[700px] w-full'
            header={{ icon: SystemIcons.Server, title: workspace?.displayName ?? 'Workspace' }}
            items={items}
            defaultValue={currentPanel}
            empty={{
                icon: <SystemIcons.Cog className='size-8 text-muted-foreground/50' />,
                title: 'Workspace Settings',
                description: 'Rename this workspace, give it an address of its own, or tear it down.',
            }}
        />
    )
}

export default WorkspaceConfiguration
