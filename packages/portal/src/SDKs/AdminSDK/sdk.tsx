import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Admin, User, Workspace } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createAdminSDKActions, type _AdminSDKActions_ } from './actions'
import { _createAdminDialogs_, type _AdminSDKDialogs } from './dialogs'

const QUERY_OPTIONS = {
    staleTime: 30_000,
    retry: 5,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30_000),
}

@SDK('Admin')
export class AdminSDKImpl extends BaseSDK<AdminSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<AdminSDK.State> = createWithEqualityFn(
        immer<AdminSDK.State>(() => ({
            workspaces: {},
            users: {},
            details: {},
        })),
        shallow
    )

    public readonly query = {
        workspacesList: {
            ...QUERY_OPTIONS,
            queryKey: ['admin', 'workspaces'] as const,
            queryFn:  () => this.actions.workspaces.list(),
        },
        workspace: (workspaceId: Workspace.Id) => ({
            ...QUERY_OPTIONS,
            queryKey: ['admin', 'workspaces', workspaceId] as const,
            queryFn:  () => this.actions.workspaces.get(workspaceId),
        }),
        usersList: {
            ...QUERY_OPTIONS,
            queryKey: ['admin', 'users'] as const,
            queryFn:  () => this.actions.users.list(),
        },
    }

    public readonly actions: AdminSDK.Actions = createAdminSDKActions(this)
    public readonly dialogs: AdminSDK.Dialogs = _createAdminDialogs_(this)
}

export const AdminSDK = SDK.get<AdminSDKImpl>('Admin')

export namespace AdminSDK {
    export type State = {
        workspaces: Record<Workspace.Id, Admin.WorkspaceSummary>
        users: Record<User.Id, Admin.UserSummary>
        /** Whatever workspace pages have been opened, by id. */
        details: Partial<Record<Workspace.Id, Admin.WorkspaceDetail>>
    }

    export type Actions = _AdminSDKActions_
    export type Dialogs = _AdminSDKDialogs
}
