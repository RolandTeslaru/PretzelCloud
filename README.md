# PretzelCloud

The private fleet layer that hosts PretzelGraph. PretzelGraph is a complete
single-workspace product; everything that knows more than one workspace exists
lives here: provisioning, routing, sign-in, billing and releases.

Every workspace is a silo: its own machines running PretzelGraph (backend,
Redis, workers), with a private database on a shared Postgres cluster.
Isolation is the connection string. PretzelGraph runs unmodified inside a silo;
the fleet talks to it only through env vars and a few HTTP endpoints.

## Packages

| Package | What it is |
|---|---|
| `packages/control-plane` | NestJS API and silo router, in one process. Everything below happens here. |
| `packages/portal` | Vite + React app where users sign in, create and manage workspaces, and see billing and usage. It also has the admin pages. |
| `packages/shared` | Domain types and zod schemas used by both. |

## Databases

| Database | Holds | Access |
|---|---|---|
| `portal` | Users, workspaces, memberships, plans, listings, templates, waitlist, Stripe events | Row-level security by membership for user requests; a service role for the control plane's own work |
| `fleet` | Clusters, hardware, machines, hostnames, releases, silo secrets, execution usage | Service role only; never reachable from a user request |
| One per workspace | That workspace's PretzelGraph data | Lives on a workspace cluster (`alpha`, `beta`, …); only its own silo holds the connection string |

Portal and fleet migrations run when the control plane boots. Workspace
databases are migrated by PretzelGraph itself when its machine starts.

## Flows

### Sign-in and workspace access

GoTrue is the fleet's one identity issuer; workspaces never run their own. The
session cookie is scoped to the parent domain, so the portal and every
workspace hostname see it.

When the editor opens, it posts to `/api/session/token` on its own workspace
hostname. The router answers that itself without waking a machine. It reads the
workspace from the Host header, checks `workspace_members`, and mints a
workspace-scoped ES256 token (`aud: workspace:<id>`, 15-minute TTL). Silos get
only the public key, through their env, so they can verify tokens but never
mint them. The key is also published at `/.well-known/jwks.json`.

### Creating a workspace

`POST /api/workspaces` writes the workspace and owner membership rows, then
provisions in the background. Each step is retried under the same id and
streamed to the portal over its websocket:

1. **hardware**: creates the workspace database on a cluster in the chosen region, plus the compute record
2. **secrets**: generates the per-workspace credentials and the cloud token
3. **machines**: builds the machines from the latest release, sized by the plan. A plan either has one combined machine or a backend plus N workers. Every machine blocks outbound SMTP and private-network access.
4. **owner**: seeds the owner into the workspace's own database, once the machines have migrated it
5. **starters**: seeds the starter workflows the release can run
6. **hostnames**: registers `<subdomain>.app.<domain>` (editor) and `<subdomain>.hooks.<domain>` (inbound webhooks)

The machine driver is `docker` locally and `fly` in production
(`MACHINE_DRIVER`). Each account can own up to `MAX_WORKSPACES_PER_OWNER`
workspaces, one by default.

### Routing a request

All workspace traffic enters through the router on `FLEET_ROUTER_PORT`. For
each request it:

1. Resolves the Host header to a workspace (cached). The `hooks` host serves only `/webhook` and `/webhook-test`.
2. Redirects anonymous page loads, and any page load for a stopped or disabled workspace, to the portal.
3. On metered paths (starting an execution), refuses if the workspace has used up its plan's executions for the period.
4. Forwards to the backend if it is up. If the workspace is asleep, it wakes it first. Normal requests wait 2s, then get a self-refreshing "starting" page or a 503 with `Retry-After`. Webhooks wait up to 10s, and their URL counts as a credential, so they can wake a workspace on their own. Any other request needs a credential before the router will spend a boot on it.

Executions are counted from the forwarded response without touching its bytes.
Every request also records activity for the idle sweep.

### Lifecycle

| State | Meaning |
|---|---|
| `running` | Serving |
| `sleeping` | Parked to save money; the next request wakes it |
| `updating` | Machines being replaced for another release; comes back on its own |
| `stopped` | The owner turned it off; traffic does not wake it |
| `disabled` | The fleet turned it off (billing or admin); only the fleet can undo it |
| `provisioning_failed` | Creation did not finish |

A sweeper (one instance at a time, via an advisory lock) runs every minute:

- **20 minutes idle**: suspends the backend, unless the plan's `idleBackendPolicy` is `none` or a worker is still running
- **7 days idle**: gives the machines back entirely. The database, hostnames and secrets stay, and the next request rebuilds the compute from its spec (a slow start).

Workers have their own lifecycle. The backend calls
`POST /api/workspaces/:id/workers/:workerId/wake|sleep` as it enqueues and
drains work, authenticated by its `x-pretzel-cloud-token`.

Owners can also start, stop, restart, rebuild, update or delete a workspace
from the portal. Operations on one workspace are serialised across
control-plane instances.

### Plans and billing

A plan is a row in `plans`, not code: machine sizes, worker count and
concurrency, idle policy, and limits (workflows, monthly executions, members,
uptime, session retention). New workspaces start on `free`.

- **First paid plan**: the portal sends the user to Stripe Checkout, which carries the workspace id in its metadata.
- **Changing plan**: an existing subscription has its price swapped instead.
- **Stripe webhook** (`/api/billing/webhook`, idempotent per event) is the only path that changes a workspace's plan. A new plan rebuilds the machines at the new size and keeps the database.
- **`past_due`** leaves the workspace running while Stripe retries the card. **`unpaid`** or an ended subscription sets it to `disabled`, keeping the plan on the row. Buying again re-enables it.
- Cards, invoices and cancellation go through the Stripe billing portal.

### Releases

`releases` is the catalogue of PretzelGraph versions (one image each for
combined, backend and worker). Each workspace is pinned to one release.
Provisioning uses the latest, and **Update** moves the pin and replaces the
machines. `GET /api/releases/latest` is public, so self-hosted installs can
check for a newer version too.

### Listings, templates and the extended shelf

A workspace can publish its workflows as **listings**, calling
`/api/workspaces/:id/listings` with its cloud token. Each listing keeps a
version per PretzelGraph release, and readers get the newest version their own
release can run. **Templates**, the **extended shelf**
(`EXTENDED_SHELF_WORKSPACE_ID`, one workspace whose listings every workspace
ships with) and the starter workflows are all built from listings.

### Waitlist and admin

- **Waitlist**: stores sign-ups and sends a thank-you from a Resend template (`RESEND_*`). Failed sends are retried by a sweep, at most one email per address.
- **Admin**: users with `is_admin` get `/admin` in the portal to search users and workspaces, set templates and the shelf, and disable or delete workspaces. See `docs/admin.md`.

## Running locally

You need Node 22, Docker, `psql`, and a `PretzelGraph` checkout next to this
one. The portal imports its UI kit, and workspace images are built from it.

```sh
cp .env.example .env       # then set CLUSTER_ADMIN_URL_ALPHA=postgres://postgres:pretzel@localhost:5434/postgres
npm install
docker compose up -d       # Postgres (control plane + two workspace clusters), GoTrue, Redis, pgweb
npm run dev                # control plane :4000, portal :5174, Stripe webhook forwarding
npm run release:local      # build PretzelGraph's images and make them the fleet's latest release
```

Start `npm run dev` once before `release:local`, so the migrations have run.
Workspaces are then reachable at `<subdomain>.app.dev.localhost:8080`. Ports
are offset from PretzelGraph's own compose stack, so you can run both at once.
Set `WORKSPACE_DEV_REPO` to your PretzelGraph path and machines will run its
built `dist` instead of the image's copy. A backend change is then just
`npm run build` and a restart.

## Shipping

- **Control plane:** merging into `latest` deploys it to Fly (`.github/workflows/deploy.yml`).
- **Workspace releases:** PretzelGraph's CI dispatches `release`, which copies
  its images into the fleet registry and announces the release to the control
  plane. `npm run release:production` is the manual fallback.

## More

- `docs/admin.md`: granting admin access and deleting workspaces
- `scripts/setup-control-plane-cluster.sh`: preparing a fresh Postgres cluster for the control plane
- `../SPECS/` and `../final-decision.md`: the architecture this implements
