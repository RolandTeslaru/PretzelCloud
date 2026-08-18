import { toast } from "sonner";
import { User } from "@pretzel-cloud/shared/domain";
import type { AuthSDK, AuthSDKImpl } from "./sdk";
import { api } from "../api";

const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

export function _createAuthActions_(sdk: AuthSDKImpl): AuthSDK.Actions {
    return {
        login: async (props) => {
            const { data, error } = await sdk.client.signInWithPassword({
                email: props.email,
                password: props.password,
            })

            if (error || !data.user) {
                toast.error(`Could not sign in: ${error?.message}`)
                return false;
            }

            await sdk.actions.syncUser()

            return sdk.state.isAuthenticated;
        },

        /**
         * Email and password only. The display name is not an issuer concern —
         * it belongs to the profile row, and is edited there.
         */
        signup: async (props) => {
            const { data, error } = await sdk.client.signUp({
                email: props.email,
                password: props.password,
            })

            if (error || !data.user) {
                toast.error(`Could not sign up: ${error?.message}`)
                return false;
            }

            // No session means the address still has to be confirmed, and there
            // is no token to register the profile row with yet.
            if (!data.session) {
                toast.info("Check your email to confirm your address.")
                return false;
            }

            await sdk.actions.syncUser()

            return sdk.state.isAuthenticated;
        },

        logout: async () => {
            const { error } = await sdk.client.signOut();

            if (error) {
                toast.error(`Could not sign out: ${error.message}`)
                return false;
            }

            sdk.setState(s => {
                s.user = null
                s.isAuthenticated = false
            })

            return true
        },

        /**
         * Creates the profile row if the account has none, and returns it either
         * way. The issuer holds the credentials; this row is the portal's own
         * record, and nothing creates it but this call.
         */
        syncUser: async () => {
            try {
                const response = await api.put('/api/me')
                const { user } = User.API.Register.Response.parse(response.data)

                sdk.setState(s => {
                    s.user = user
                    s.isAuthenticated = true
                    s.isLoading = false
                })
            }
            catch (error) {
                console.error("Failed to register profile", error)
                toast.error(`Could not load your profile: ${message(error)}`)

                sdk.setState(s => { s.isLoading = false })
            }
        },

        updateMe: async (props) => {
            const response = await api.patch('/api/me', props)
            const { user } = User.API.Update.Response.parse(response.data)

            sdk.setState(s => { s.user = user })

            return user;
        },
    }
}
