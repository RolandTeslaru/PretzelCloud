import type { CSSProperties } from 'react'
import { SidebarTabs } from '@pretzel-graph/standard-ui/components/SidebarTabs'
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

type SurfaceProps = { surfaceStyle: CSSProperties; blockTransparency: boolean }

const WorkspaceConfiguration = ({ workspaceId, dialogId, currentPanel, surfaceStyle, blockTransparency }: PanelProps & { currentPanel?: ItemId } & SurfaceProps) => {
    const workspace = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])

    const panelProps = { workspaceId, dialogId }

    const items: SidebarTabs.Item[] = [
        { id: 'general',   label: 'General',     icon: SystemIcons.Settings,      panel: <GeneralSettings {...panelProps} /> },
        { id: 'domain',    label: 'Domain',      icon: SystemIcons.Globe,         panel: <DomainSettings {...panelProps} /> },
        { id: 'plan',      label: 'Plan',        icon: SystemIcons.Receipt,       panel: <PlanSettings {...panelProps} /> },
        { id: 'lifecycle', label: 'Lifecycle',   icon: SystemIcons.Power,         panel: <LifecycleSettings {...panelProps} /> },
        { id: 'danger',    label: 'Danger zone', icon: SystemIcons.AlertTriangle, panel: <DangerSettings {...panelProps} />, tone: 'destructive' },
    ]

    return (
        <SidebarTabs
            surfaceStyle={surfaceStyle}
            blockTransparency={blockTransparency}
            header={{ icon: SystemIcons.Server, title: workspace?.displayName ?? 'Workspace' }}
            items={items}
            defaultValue={currentPanel}
            empty={{
                icon: <Illustrations.GearIllustration className='size-15 text-muted-foreground/50' />,
                title: 'Workspace Settings',
                description: 'Rename this workspace, give it an address of its own, or tear it down.',
            }}
        />
    )
}

export default WorkspaceConfiguration
