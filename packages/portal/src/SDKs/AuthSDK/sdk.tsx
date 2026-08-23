import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { User } from "@pretzel-cloud/shared/domain";
import { BaseSDK } from "@pretzel-graph/standard-ui/SDKs/Base";
import { SDK } from "@pretzel-graph/standard-ui/SDKs/SDKManager";
import { DialogSDK } from "@pretzel-graph/standard-ui/SDKs/DialogSDK";
import { AlertDialog } from "@pretzel-graph/standard-ui/foundations";
import { authClient, getToken } from "./client";
import { _createAuthActions_ } from "./actions";
import { DeleteAccountDialog } from "./ui/DeleteAccountDialog";

const LOGOUT_DIALOG_ID = 'logout'
const DELETE_ACCOUNT_DIALOG_ID = 'delete-account'

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

    /** Confirms first: signing out is one click from anywhere the menu opens. */
    public openLogOutDialog = () => {
        DialogSDK.actions.push(LOGOUT_DIALOG_ID, props => (
            <DialogSDK.AlertTemplate
                {...props}
                type='warning'
                approveLabel='Log out'
                onApprove={async () => {
                    await this.actions.logout()
                    DialogSDK.actions.pop(LOGOUT_DIALOG_ID)
                }}
                onCancel={() => DialogSDK.actions.pop(LOGOUT_DIALOG_ID)}
            >
                <AlertDialog.Title>Log out?</AlertDialog.Title>
                <AlertDialog.Description>
                    You will need to sign in again to reach your workspaces.
                </AlertDialog.Description>
            </DialogSDK.AlertTemplate>
        ))
    }

    /** Nothing here is recoverable, so the dialog asks for it in writing. */
    public openDeleteAccountDialog = () => {
        DialogSDK.actions.push(DELETE_ACCOUNT_DIALOG_ID, props => (
            <DeleteAccountDialog
                {...props}
                onApprove={async () => {
                    await this.actions.deleteAccount()
                    DialogSDK.actions.pop(DELETE_ACCOUNT_DIALOG_ID)
                }}
                onCancel={() => DialogSDK.actions.pop(DELETE_ACCOUNT_DIALOG_ID)}
            />
        ))
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
        // Tears down every workspace it owns, then the account itself. Ends the session.
        deleteAccount: () => Promise<boolean>
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
