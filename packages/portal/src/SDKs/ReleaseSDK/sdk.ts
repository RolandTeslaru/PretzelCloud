import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Fleet } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { api } from '@/SDKs/api'

// A release lands on the order of weeks; a session reads it once.
const LATEST_STALE_TIME = Infinity

@SDK('Release')
export class ReleaseSDKImpl extends BaseSDK<ReleaseSDK.State> {

    constructor() { super() }

    public readonly useStore: BaseSDK.Store<ReleaseSDK.State> = createWithEqualityFn(
        immer<ReleaseSDK.State>(() => ({
            latest: null,
        })),
        shallow
    )

    public readonly query = {
        latest: {
            queryKey:  ['releases', 'latest'] as const,
            queryFn:   async () => {
                // A deployment with no announced release answers 404; no release is a state, not an error.
                const latest = await Fleet.Release.API.latest(api).catch(() => null)

                this.useStore.setState((s) => { s.latest = latest })

                return latest
            },
            staleTime: LATEST_STALE_TIME,
        },
    }
}

export const ReleaseSDK = SDK.get<ReleaseSDKImpl>('Release')

export namespace ReleaseSDK {
    export type State = {
        latest: Fleet.Release.API.Latest.Response | null
    }
}
