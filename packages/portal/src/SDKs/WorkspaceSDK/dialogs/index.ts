import { Workspace } from '@pretzel-cloud/shared/domain'
import type { WorkspaceSDKImpl } from '../sdk'
import {
    openConfigurationDialog,
    openCreateWorkspaceDialog,
    openDestroyDialog,
    openUpdateDialog,
} from '../open-dialogs'

export function _createWorkspaceDialogs_(sdk: WorkspaceSDKImpl) {
    return {
        openCreateWorkspace: openCreateWorkspaceDialog,
        openConfiguration:   openConfigurationDialog,
        openUpdate:          openUpdateDialog,
        openDestroy:         (workspaceId: Workspace.Id) => openDestroyDialog(sdk, workspaceId),
    }
}

export type _WorkspaceSDKDialogs = ReturnType<typeof _createWorkspaceDialogs_>
