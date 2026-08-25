import { z } from "zod"
import { WorkspaceId } from "../Workspace/ids"
import { Subdomain } from "../Workspace/subdomain"

// A hostname a workspace answers at, and the only thing an inbound request
// carries to say which workspace it belongs to.
export namespace Hostname {

    // 'app' is the editor, 'hooks' is inbound webhooks. Separate hostnames so
    // the two can be rate-limited and routed independently.
    export const Kind = z.enum(["app", "hooks"])
    export type  Kind = z.infer<typeof Kind>

    export namespace Host {

        /**
         * What arrives in the Host header, so the port is part of it whenever it
         * is not the scheme's default — `wspace-….app.localhost:8080` in dev,
         * bare in production.
         */
        export const Schema = z.string()
            .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/, 'A lower case DNS name, optionally with a port')
            .max(253)
            .brand("Fleet.Hostname.Host")

        /**
         * The fleet's own domain, read here rather than passed in: every caller
         * would otherwise have to fetch the same value, and one of them getting
         * it wrong means a hostname that resolves nowhere.
         */
        function getDomain(): string {
            const value = process.env.FLEET_DOMAIN;

            if (!value)
                throw new Error('FLEET_DOMAIN is not set');

            return value;
        }

        /**
         * The one place a hostname is assembled. Lookups match on equality, so
         * the writer and the router have to agree byte for byte.
         */
        export const create = (subdomain: Subdomain, kind: Kind) =>
            Schema.parse(`${subdomain}.${kind}.${getDomain()}`)

        /** Every hostname one subdomain answers at — one per kind. */
        export const createAll = (subdomain: Subdomain) =>
            Kind.options.map((kind) => ({ host: create(subdomain, kind), kind }))

        /**
         * Scheme, host and port — no path. What a browser is navigated to, and
         * what an `Origin` header is compared against. Plain HTTP only where the
         * domain is local: everywhere else a workspace is reached over TLS.
         */
        export const getOrigin = (subdomain: Subdomain, kind: Kind): string => {
            const host   = create(subdomain, kind)
            const scheme = process.env.FLEET_SCHEME ?? (host.includes('localhost') ? 'http' : 'https')

            return `${scheme}://${host}`
        }

        /** The parent the portal and every workspace share, so one cookie covers them. */
        export const getCookieDomain = (): string => getDomain().split(':')[0]!
    }
    export type Host = z.infer<typeof Host.Schema>

    export const Schema = z.object({
        host:        Host.Schema,
        workspaceId: WorkspaceId,
        kind:        Kind,
        createdAt:   z.coerce.date(),
    })
}
export type Hostname = z.infer<typeof Hostname.Schema>
