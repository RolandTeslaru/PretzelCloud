import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { Fleet } from '@pretzel-cloud/shared/domain'
import { BaseSDK } from '@pretzel-graph/standard-ui/SDKs/Base'
import { SDK } from '@pretzel-graph/standard-ui/SDKs/SDKManager'
import { QuerySDK } from '@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk'
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

    private readonly latestQuery = {
        queryKey:  ['releases', 'latest'] as const,
        queryFn:   async () => {
            // TEMP: a release no workspace runs, so the update affordance always
            // renders while its styling is worked on. Remove when done.
            if (import.meta.env.DEV) {
                const dummy = {
                    id:   'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as Fleet.Release.Id,
                    name: 'v9.9.9-dummy' as Fleet.Release.Name,
                }

                this.useStore.setState((s) => { s.latest = dummy })

                return dummy
            }

            // A deployment with no announced release answers 404; no release is a state, not an error.
            const latest = await Fleet.Release.API.latest(api).catch(() => null)

            this.useStore.setState((s) => { s.latest = latest })

            return latest
        },
        staleTime: LATEST_STALE_TIME,
    }

    /** Fire and forget from route loaders; the store fills when the answer lands. */
    public fetchLatest = () => QuerySDK.client.fetchQuery(this.latestQuery)
}

export const ReleaseSDK = SDK.get<ReleaseSDKImpl>('Release')

export namespace ReleaseSDK {
    export type State = {
        latest: Fleet.Release.API.Latest.Response | null
    }
}
