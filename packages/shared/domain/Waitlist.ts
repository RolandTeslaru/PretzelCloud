import { z } from "zod"

// People asking to hear when cloud hosting opens.
export namespace Waitlist {

    // Lowercased, so one address cannot join twice under two spellings.
    export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email())
    export type  Email = z.infer<typeof Email>

    export namespace API {

        export namespace Join {
            export const Request = z.object({ email: Email })
            export type  Request = z.infer<typeof Request>
        }
    }
}
