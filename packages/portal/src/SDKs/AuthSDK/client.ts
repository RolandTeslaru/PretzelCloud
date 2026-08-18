import { GoTrueClient } from "@supabase/auth-js";

// A leaf module on purpose: the api client and the SDK both need the token, and
// importing either from the other would be a cycle.
const g = globalThis as unknown as { __authClient?: GoTrueClient };

/** The fleet issuer's client. Everything that needs a token goes through here. */
export const authClient: GoTrueClient = (g.__authClient ??= new GoTrueClient({
    url: import.meta.env?.VITE_AUTH_URL || "http://localhost:9998",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
}));

/** The current access token, or null when signed out. */
export async function getToken(): Promise<string | null> {
    const { data } = await authClient.getSession()

    return data.session?.access_token ?? null
}
