import { Admin } from '@pretzel-cloud/shared/domain'
import type { AdminSDKImpl } from '../sdk'
import { openDeleteUserDialog, openDeleteWorkspaceDialog } from '../open-dialogs'

export function _createAdminDialogs_(sdk: AdminSDKImpl) {
    return {
        openDeleteWorkspace: (summary: Admin.WorkspaceSummary, onDeleted?: () => void) => openDeleteWorkspaceDialog(sdk, summary, onDeleted),
        openDeleteUser:      (user: Admin.UserSummary) => openDeleteUserDialog(sdk, user),
    }
}

export type _AdminSDKDialogs = ReturnType<typeof _createAdminDialogs_>
