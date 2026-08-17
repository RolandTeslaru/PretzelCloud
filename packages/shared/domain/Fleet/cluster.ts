import { z } from "zod"

/**
 * A Postgres cluster, in the abstract: databases, roles, and the URL that opens
 * a session on one. It knows nothing about workspaces — what a workspace's
 * database is called is the workspace's business, and lives there.
 */
export namespace Cluster {

    // Unquoted identifiers are folded to lower case and capped at 63 bytes.
    const Identifier = z.string()
        .regex(/^[a-z_][a-z0-9_]*$/, 'Lower case, digits and underscores; must not start with a digit')
        .max(63, 'Postgres truncates identifiers past 63 bytes')

    export namespace Database {

        export const Name = Identifier.brand("Cluster.Database.Name")
        export type  Name = z.infer<typeof Name>

        /**
         * Everything needed to open a session, in one value: role, password,
         * host, database. This string *is* the tenancy boundary.
         */
        export const ConnectionURL = z.string()
            .startsWith("postgres://")
            .brand("Cluster.Database.ConnectionURL")
        export type  ConnectionURL = z.infer<typeof ConnectionURL>

        /**
         * The password must already be URL-safe — a `/` or `@` in it would end
         * the field early and the parser would read the rest as a host.
         */
        export const createConnectionURL = (parts: {
            roleName: Role.Name,
            password: Role.Password,
            host: string,
            databaseName: Name,
        }) => ConnectionURL.parse(
            `postgres://${parts.roleName}:${parts.password}@${parts.host}/${parts.databaseName}`,
        )

        /** For logs and errors. The password is the only part worth hiding. */
        export const redact = (connection: ConnectionURL) =>
            connection.replace(/:[^:@]*@/, ':****@')
    }

    export namespace Role {

        export const Name = Identifier.brand("Cluster.Role.Name")
        export type  Name = z.infer<typeof Name>

        export namespace Password {

            /** Base64url only, so it survives being spliced into a connection URL. */
            export const Schema = z.string()
                .regex(/^[A-Za-z0-9_-]+$/)
                .min(16)
                .brand("Cluster.Role.Password")

            const BYTES = 24

            /**
             * Web crypto rather than `node:crypto`, so this module stays
             * importable from a browser bundle.
             */
            export function create(): Password {
                const bytes = new Uint8Array(BYTES)

                crypto.getRandomValues(bytes)

                const base64 = btoa(String.fromCharCode(...bytes))

                return Schema.parse(base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
            }
        }
        export type Password = z.infer<typeof Password.Schema>
    }
}
