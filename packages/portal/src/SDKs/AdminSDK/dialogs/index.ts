import { Admin, Plan, Workspace } from '@pretzel-cloud/shared/domain'
import type { AdminSDKImpl } from '../sdk'
import { openDeleteUserDialog, openDeleteWorkspaceDialog, openDisableWorkspaceDialog, openSetPlanDialog, openSetShelfBlueprintDialog, openSetTemplateDialog } from '../open-dialogs'

export function _createAdminDialogs_(sdk: AdminSDKImpl) {
    return {
        openDeleteWorkspace: (summary: Admin.WorkspaceSummary, onDeleted?: () => void) => openDeleteWorkspaceDialog(sdk, summary, onDeleted),
        openDisableWorkspace: (summary: Admin.WorkspaceSummary) => openDisableWorkspaceDialog(sdk, summary),
        openSetPlan:          (workspace: Workspace, plan: Plan) => openSetPlanDialog(sdk, workspace, plan),
        openDeleteUser:      (user: Admin.UserSummary) => openDeleteUserDialog(sdk, user),
        openSetTemplate:      (listing: Admin.ListingSummary) => openSetTemplateDialog(sdk, listing),
        openSetShelfBlueprint: (listing: Admin.ListingSummary) => openSetShelfBlueprintDialog(sdk, listing),
    }
}

export type _AdminSDKDialogs = ReturnType<typeof _createAdminDialogs_>
