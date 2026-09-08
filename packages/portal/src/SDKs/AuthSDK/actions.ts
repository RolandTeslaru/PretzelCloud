import { NotificationSDK } from "@pretzel-graph/standard-ui/SDKs/NotificationSDK";
import { User } from "@pretzel-cloud/shared/domain";
import type { AuthSDK, AuthSDKImpl } from "./sdk";
import { api, getMessageFromError } from "../api";

/** Signed in at the issuer, but with no profile row here yet. */
const isMissingProfile = (error: unknown) =>
    (error as { response?: { status?: number } })?.response?.status === 404

const metadataString = (metadata: Record<string, unknown>, key: string): string => {
    const value = metadata[key]

    return typeof value === 'string' ? value.trim() : ''
}

/** A provider's handle, bent into something the username rule accepts. */
const toUsername = (handle: string): string => {
    const cleaned = handle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

    const result = User.Username.safeParse(cleaned)

    return result.success ? result.data : ''
}

export function _createAuthActions_(sdk: AuthSDKImpl): AuthSDK.Actions {
    return {
        login: async (props) => {
            const { data, error } = await sdk.client.signInWithPassword({
                email: props.email,
                password: props.password,
            })

            if (error || !data.user) {
                NotificationSDK.toast.error(`Could not sign in: ${error?.message}`)
                return false;
            }

            await sdk.actions.syncUser()

            return sdk.state.isAuthenticated;
        },

        /**
         * The issuer is given email and password only. The username and display
         * name are profile fields, so they go to our own endpoint once a
         * session exists.
         */
        signup: async (props) => {
            // A previous attempt may have created the account and failed only on
            // the profile; reusing that session lets a retry pick a free username
            // instead of signing up an address the issuer already knows.
            let session = (await sdk.client.getSession()).data.session

            if (!session) {
                const { data, error } = await sdk.client.signUp({
                    email: props.email,
                    password: props.password,
                })

                if (error || !data.user) {
                    NotificationSDK.toast.error(`Could not sign up: ${error?.message}`)
                    return false;
                }

                // No session means the address still has to be confirmed, and
                // there is no token to register the profile row with yet.
                if (!data.session) {
                    NotificationSDK.toast.info("Check your email to confirm your address.")
                    return false;
                }

                session = data.session
            }

            try {
                await sdk.actions.register({ username: props.username, displayName: props.displayName })
            }
            catch (error) {
                NotificationSDK.toast.error(getMessageFromError(error))
                return false;
            }

            return sdk.state.isAuthenticated;
        },

        loginWithProvider: async (provider) => {
            // The issuer only redirects to addresses it was told are ours, and
            // that is the origin. The landing page's guard does the rest.
            const { error } = await sdk.client.signInWithOAuth({
                provider,
                options: { redirectTo: `${location.origin}/` },
            })

            if (error) {
                NotificationSDK.toast.error(`Could not sign in with ${provider}: ${error.message}`)
                return false;
            }

            return true;
        },

        suggestProfile: async () => {
            const { data } = await sdk.client.getSession()

            const metadata = data.session?.user.user_metadata ?? {}

            const handle = metadataString(metadata, 'user_name') || metadataString(metadata, 'preferred_username')

            const displayName = metadataString(metadata, 'full_name') || metadataString(metadata, 'name') || handle

            return {
                username:    toUsername(handle),
                displayName: displayName.slice(0, 64),
            }
        },

        logout: async () => {
            const { error } = await sdk.client.signOut();

            if (error) {
                NotificationSDK.toast.error(`Could not sign out: ${error.message}`)
                return false;
            }

            sdk.setState(s => {
                s.user = null
                s.isAuthenticated = false
                s.needsProfile = false
            })

            return true
        },

        /**
         * Ends the account. The control plane tears down every workspace it owns
         * and removes the issuer's record of it, so the session that made the
         * request no longer belongs to anyone — the local one is cleared here.
         */
        deleteAccount: async () => {
            try {
                await User.API.deleteAccount(api)
            }
            catch (error) {
                NotificationSDK.toast.error(getMessageFromError(error))

                return false
            }

            // The issuer no longer knows this account, so a failure to reach it
            // is expected; what matters is that nothing is left on this device.
            await sdk.client.signOut().catch(() => {})

            sdk.setState(s => {
                s.user = null
                s.isAuthenticated = false
                s.needsProfile = false
            })

            return true
        },

        /**
         * Creates the profile row if the account has none, and returns it either
         * way. The issuer holds the credentials; this row is the portal's own
         * record, and nothing creates it but this call.
         */
        /**
         * The boot path: a session says who you are, this says whether this
         * deployment knows you. A 404 means sign-up never finished, so the
         * guard sends them back to the form to choose a username.
         */
        syncUser: async () => {
            try {
                const { user } = await User.API.get(api)

                sdk.setState(s => {
                    s.user = user
                    s.isAuthenticated = true
                    s.isLoading = false
                    s.needsProfile = false
                })
            }
            catch (error) {
                const missingProfile = isMissingProfile(error)

                if (!missingProfile) {
                    NotificationSDK.toast.error(`Could not load your profile: ${getMessageFromError(error)}`)
                }

                sdk.setState(s => {
                    s.user = null
                    s.isAuthenticated = false
                    s.isLoading = false
                    s.needsProfile = missingProfile
                })
            }
        },

        register: async (profile) => {
            const { user } = await User.API.register(api, profile)

            sdk.setState(s => {
                s.user = user
                s.isAuthenticated = true
                s.isLoading = false
                s.needsProfile = false
            })
        },

        updateMe: async (props) => {
            const { user } = await User.API.update(api, props)

            sdk.setState(s => { s.user = user })

            return user;
        },
    }
}
