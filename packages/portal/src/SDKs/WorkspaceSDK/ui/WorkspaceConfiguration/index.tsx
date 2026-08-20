import React, { useState } from 'react'
import { ScrollArea, Separator } from '@pretzel-graph/standard-ui/foundations'
import { Illustrations, SystemIcons } from '@pretzel-graph/standard-ui/icons'
import { DialogSDK } from '@pretzel-graph/standard-ui/SDKs/DialogSDK'
import { cn } from '@pretzel-graph/standard-ui/utils/cn'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { WorkspaceSDK } from '../../sdk'
import { GeneralSettings } from './GeneralSettings'
import { DomainSettings } from './DomainSettings'
import { DangerSettings } from './DangerSettings'

// Per workspace, so opening one from another card does not reuse its panel state.
const dialogId = (workspaceId: Workspace.Id) => `workspace-configuration-${workspaceId}`

export function openWorkspaceConfigurationDialog(workspaceId: Workspace.Id) {
    const id = dialogId(workspaceId)

    DialogSDK.actions.push(id, (props) => (
        <DialogSDK.Template {...props} className={'sm:max-w-[680px] w-full'}>
            <WorkspaceConfiguration workspaceId={workspaceId} dialogId={id} />
        </DialogSDK.Template>
    ))
}

type ItemId = 'general' | 'domain' | 'danger'

type PanelProps = { workspaceId: Workspace.Id; dialogId: string }

const ITEMS: { id: ItemId; icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
    { id: 'general', icon: SystemIcons.Settings,      label: 'General' },
    { id: 'domain',  icon: SystemIcons.Globe,         label: 'Domain' },
    { id: 'danger',  icon: SystemIcons.AlertTriangle, label: 'Danger zone' },
]

const LABELS: Record<ItemId, string> = {
    general: 'General',
    domain:  'Domain',
    danger:  'Danger zone',
}

const PANELS: Record<ItemId, React.FC<PanelProps>> = {
    general: GeneralSettings,
    domain:  DomainSettings,
    danger:  DangerSettings,
}

const WorkspaceConfiguration = ({ workspaceId, dialogId }: PanelProps) => {
    const [activeId, setActiveId] = useState<ItemId | null>(null)

    const workspace   = WorkspaceSDK.useStore((s) => s.workspaces[workspaceId])
    const ActivePanel = activeId ? PANELS[activeId] : null

    
    return (
        <div className='pl-2 flex flex-row gap-4 !overflow-hidden'>
            <div className='p-0.5 py-2 w-50 shrink-0 border-r border-border'>
                <div className='inline-flex items-center px-1'>
                    <SystemIcons.Server className='size-4 m-2' />
                    <p className='font-medium w-35 text-sm text-ellipsis text-nowrap overflow-hidden'>{workspace?.displayName ?? 'Workspace'}</p>
                </div>

                <Separator className='w-[calc(100%-0.5rem)]! mx-auto' />

                <div className='py-2 px-1 flex flex-col gap-1'>
                    {ITEMS.map(item => (
                        <div
                            key={item.id}
                            onClick={() => setActiveId(item.id)}
                            className={cn(
                                'flex flex-row items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-accent/30',
                                activeId === item.id && 'bg-accent/50',
                                item.id === 'danger' && 'text-destructive',
                            )}
                        >
                            <item.icon className='size-4' />
                            <p className='text-sm'>{item.label}</p>
                        </div>
                    ))}
                </div>
            </div>

            <ScrollArea.Root className='flex-1 min-h-[460px] max-h-[460px] pr-2'>
                <div className='inline-flex z-100 items-center absolute w-full top-0 left-0 gap-2 h-9 mt-2 shrink-0'>
                    <p className='text-sm font-medium'>{activeId && LABELS[activeId]}</p>
                </div>

                {ActivePanel ? (
                    <>
                        <div className='content-[" "] h-12'></div>
                        <ActivePanel workspaceId={workspaceId} dialogId={dialogId} />
                    </>
                ) : (
                    <div className='absolute top-1/2 -translate-1/2 left-1/2 w-[300px] flex flex-col gap-2 p-6 h-full justify-center items-center text-center'>
                        <Illustrations.GearIllustration className='size-15 text-muted-foreground/50' />
                        <p className='text-sm font-medium'>Workspace Settings</p>
                        <p className='text-xs text-muted-foreground max-w-55'>
                            Rename this workspace, give it an address of its own, or tear it down.
                        </p>
                    </div>
                )}
            </ScrollArea.Root>
        </div>
    )
}

export default WorkspaceConfiguration
