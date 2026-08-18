import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { User } from "@pretzel-cloud/shared/domain";
import { BaseSDK } from "@pretzel-graph/standard-ui/SDKs/Base";
import { SDK } from "@pretzel-graph/standard-ui/SDKs/SDKManager";
import { authClient, getToken } from "./client";
import { _createAuthActions_ } from "./actions";

@SDK("Auth")
export class AuthSDKImpl extends BaseSDK<AuthSDK.State> {
    constructor() { super() }

    public readonly client = authClient
    public readonly getToken = getToken

    public readonly useStore: BaseSDK.Store<AuthSDK.State> = create(
        immer<AuthSDK.State>(() => ({
            isAuthenticated: false,
            user: null,
            isLoading: true,
        }))
    )

    /** Recover an existing session, then keep the store in step with the issuer. */
    public async init() {
        const { data: { session }, error } = await this.client.getSession()

        if (error) {
            console.error("Error fetching session", error)
        }

        if (session?.user) {
            await this.actions.syncUser()
        } else {
            this.setState(s => { s.isLoading = false })
        }

        this.client.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                setTimeout(() => { this.actions.syncUser() }, 0)
            }
            else if (event === 'SIGNED_OUT') {
                this.setState(s => {
                    s.user = null
                    s.isAuthenticated = false
                    s.isLoading = false
                })
            }
        })
    }

    public readonly actions: AuthSDK.Actions = _createAuthActions_(this);
}

export namespace AuthSDK {
    export type State = {
        isAuthenticated: boolean;
        user: User | null;
        isLoading: boolean;
    }

    export type Actions = {
        login:  (props: { email: string, password: string }) => Promise<boolean>
        signup: (props: { email: string, password: string, username: string, displayName: string }) => Promise<boolean>
        logout: () => Promise<boolean>
        // Creates the profile row. Throws on a taken username so the sign-up
        // form can map it onto the field.
        register: (profile: User.API.Register.Request) => Promise<void>
        // The boot path: loads the profile, or clears the session if there is none.
        syncUser: () => Promise<void>
        // Throws on failure so callers can map a 409 onto the offending form field.
        updateMe: (props: User.API.Update.Request) => Promise<User>
    }
}

export const AuthSDK = SDK.get<AuthSDKImpl>("Auth")
