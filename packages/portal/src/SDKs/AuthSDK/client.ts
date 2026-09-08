import { GoTrueClient } from "@supabase/auth-js";
import { cookieStorage, PRETZEL_STORAGE_KEY } from "@pretzel-graph/standard-ui/utils/cookieStorage";

// A leaf module on purpose: the api client and the SDK both need the token, and
// importing either from the other would be a cycle.
const g = globalThis as unknown as { __authClient?: GoTrueClient };

/** Where the fleet issuer is, as a browser reaches it. */
export const AUTH_URL: string = import.meta.env?.VITE_AUTH_URL || "http://localhost:9998"

/** The fleet issuer's client. Everything that needs a token goes through here. */
export const authClient: GoTrueClient = (g.__authClient ??= new GoTrueClient({
    url: AUTH_URL,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // A cookie rather than localStorage: the editor runs on its own hostname,
    // and only a domain-scoped value is visible to both.
    storageKey: PRETZEL_STORAGE_KEY,
    storage: cookieStorage({ domain: import.meta.env?.VITE_SESSION_COOKIE_DOMAIN }),
}));

/** The current access token, or null when signed out. */
export async function getToken(): Promise<string | null> {
    const { data } = await authClient.getSession()

    return data.session?.access_token ?? null
}
