import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Workspace } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { createEntitlementSDKActions, type _EntitlementSDKActions_ } from './actions'

export const DEFAULT_WINDOW: Workspace.Usage.Window = 'week'

@SDK('Entitlement')
export class EntitlementSDKImpl extends BaseSDK<EntitlementSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<EntitlementSDK.State> = createWithEqualityFn(
        immer<EntitlementSDK.State>(() => ({
            windows: {},
        })),
        shallow
    )

    public readonly actions: EntitlementSDK.Actions = createEntitlementSDKActions(this)
}

export const EntitlementSDK = SDK.get<EntitlementSDKImpl>('Entitlement')

export namespace EntitlementSDK {
    export type State = {
        // Kept here rather than in each table, so a window survives navigating
        // away and back. Absent means DEFAULT_WINDOW.
        windows: Partial<Record<Workspace.Id, Workspace.Usage.Window>>
    }

    export type Actions = _EntitlementSDKActions_
}
