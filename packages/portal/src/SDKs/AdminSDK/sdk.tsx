import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Admin } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
import { createAdminSDKActions, type _AdminSDKActions_ } from './actions'
import { openDeleteUserDialog, openDeleteWorkspaceDialog } from './open-dialogs'

@SDK('Admin')
export class AdminSDKImpl extends BaseSDK<AdminSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<AdminSDK.State> = createWithEqualityFn(
        immer<AdminSDK.State>(() => ({
            workspaces: [],
            users: [],
        })),
        shallow
    )

    /** One descriptor, so every caller names the same cache entry. */
    private readonly workspacesQuery = {
        queryKey: ['admin', 'workspaces'] as const,
        queryFn:  () => this.actions.workspaces.list(),
    }

    /** Seeds the store; deletes patch it from there. */
    public useWorkspacesQuery = () => QuerySDK.useQuery<Admin.WorkspaceSummary[], Error>(
        this.workspacesQuery.queryKey,
        this.workspacesQuery.queryFn,
    )

    /** The same query for route loaders, which run before anything renders. */
    public fetchWorkspaces = () => QuerySDK.client.fetchQuery(this.workspacesQuery)

    private readonly usersQuery = {
        queryKey: ['admin', 'users'] as const,
        queryFn:  () => this.actions.users.list(),
    }

    public useUsersQuery = () => QuerySDK.useQuery<Admin.UserSummary[], Error>(
        this.usersQuery.queryKey,
        this.usersQuery.queryFn,
    )

    public fetchUsers = () => QuerySDK.client.fetchQuery(this.usersQuery)

    public openDeleteWorkspaceDialog = (summary: Admin.WorkspaceSummary) => openDeleteWorkspaceDialog(this, summary)

    public openDeleteUserDialog = (user: Admin.UserSummary) => openDeleteUserDialog(this, user)

    public readonly actions: AdminSDK.Actions = createAdminSDKActions(this)
}

export const AdminSDK = SDK.get<AdminSDKImpl>('Admin')

export namespace AdminSDK {
    export type State = {
        workspaces: Admin.WorkspaceSummary[]
        users: Admin.UserSummary[]
    }

    export type Actions = _AdminSDKActions_
}
