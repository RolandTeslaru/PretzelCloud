#!/usr/bin/env bash
#
# Ships a release: builds the three roles from the Pretzel-Graph checkout,
# pushes them digest-pinned to the fleet registry, and announces the release to
# the control plane, which mints the row. The manual fallback for the pipeline;
# a release is this one invocation.
#
#   npm run release:production   the fleet's app, announced to production
#   npm run release:dev          the dev app, announced to the control plane on this machine
#
# Env: FLY_APP, FLY_API_TOKEN, AUTH_JWT_SECRET, OPERATOR_USER_ID — read from the
# files in ENV_FILES when not already set. CONTROL_PLANE_URL defaults to
# production; RELEASE_BRANCH to `latest`. ALLOW_DIRTY=1 names the build after the
# working tree rather than the commit alone.

set -euo pipefail

CLOUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH="$(cd "$CLOUD/../PretzelGraph" && pwd)"

# The first file that names a key wins, so a dev release reads the dev app from
# .env.fly and falls back to .env for what only the local fleet has.
ENV_FILES="${ENV_FILES:-.env.production}"

env_from_files() {
    for file in $ENV_FILES; do
        value=$(grep "^$1=" "$CLOUD/$file" 2>/dev/null | cut -d= -f2- || true)

        [ -n "$value" ] && { echo "$value"; return; }
    done
}

FLY_API_TOKEN="${FLY_API_TOKEN:-$(env_from_files FLY_API_TOKEN)}"
AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(env_from_files AUTH_JWT_SECRET)}"
OPERATOR_USER_ID="${OPERATOR_USER_ID:-$(env_from_files OPERATOR_USER_IDS | cut -d, -f1)}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://api.pretzelgraph.ai}"
RELEASE_BRANCH="${RELEASE_BRANCH:-latest}"
FLY_APP="${FLY_APP:-$(env_from_files FLY_APP)}"

for name in FLY_APP FLY_API_TOKEN AUTH_JWT_SECRET OPERATOR_USER_ID; do
    [ -n "${!name:-}" ] || { echo "$name is not set" >&2; exit 1; }
done

# The announce step's node one-liner reads these from its own environment.
export FLY_API_TOKEN AUTH_JWT_SECRET OPERATOR_USER_ID

BRANCH=$(git -C "$GRAPH" rev-parse --abbrev-ref HEAD)

[ "$BRANCH" = "$RELEASE_BRANCH" ] || { echo "Pretzel-Graph is on '$BRANCH', not '$RELEASE_BRANCH' — check out the release branch first" >&2; exit 1; }

SHA=$(git -C "$GRAPH" rev-parse --short HEAD)

if ! git -C "$GRAPH" diff --quiet; then
    [ "${ALLOW_DIRTY:-}" = "1" ] || { echo "Pretzel-Graph has uncommitted changes — a release names a commit" >&2; exit 1; }

    # A repeated name is dropped rather than becoming the latest, so each build gets its own.
    SHA="$SHA-dirty-$(date +%H%M%S)"
fi

# The version the manifest declares; bumped in the pull request that ships it.
NAME=$(node -p "require('$GRAPH/package.json').version")

[ -n "$NAME" ] && [ "$NAME" != "undefined" ] || { echo "$GRAPH/package.json declares no version" >&2; exit 1; }

# The commit rides along: one version is released many times over against a dev fleet.
[ "${ALLOW_DIRTY:-}" = "1" ] && NAME="$NAME+$SHA"

CONFIG=$(mktemp -t release-fly-config).toml

printf 'app = "%s"\n' "$FLY_APP" > "$CONFIG"

declare -A DIGEST_BY_ROLE

for role in combined backend worker; do
    tag="pretzelgraph-$role-$SHA"
    image="registry.fly.io/$FLY_APP:$tag"

    echo "Building $role from $GRAPH at $SHA"

    (
        cd "$GRAPH"
        fly deploy --build-only --push --remote-only --yes \
            --config "$CONFIG" \
            --dockerfile "$GRAPH/Dockerfile.$role" \
            --image-label "$tag"
    )

    # Retried: the tag is not always readable the instant the push returns.
    digest=""
    for attempt in 1 2 3 4 5; do
        digest=$(docker manifest inspect --verbose "$image" 2>/dev/null \
            | python3 -c 'import sys,json; print(json.load(sys.stdin)["Descriptor"]["digest"])' 2>/dev/null) && break
        sleep 2
    done

    [ -n "$digest" ] || { echo "Pushed $image, but could not read its digest — is docker logged in? (fly auth docker)" >&2; exit 1; }

    DIGEST_BY_ROLE[$role]="registry.fly.io/$FLY_APP@$digest"

    echo "  $role → ${DIGEST_BY_ROLE[$role]}"
done

# The announce call authenticates as the operator; the control plane mints the id.
TOKEN=$(node -e "
const crypto = require('crypto');
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: 'HS256', typ: 'JWT' });
const payload = b64({ sub: process.env.OPERATOR_USER_ID, email: 'release@pretzelgraph.ai', aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 300 });
const signature = crypto.createHmac('sha256', process.env.AUTH_JWT_SECRET).update(header + '.' + payload).digest('base64url');
console.log(header + '.' + payload + '.' + signature);
" 2>/dev/null)

# The body of the commit being shipped, whatever its shape.
DESCRIPTION=$(git -C "$GRAPH" log -1 --format=%b)

PAYLOAD=$(NAME="$NAME" DESCRIPTION="$DESCRIPTION" \
    COMBINED="${DIGEST_BY_ROLE[combined]}" BACKEND="${DIGEST_BY_ROLE[backend]}" WORKER="${DIGEST_BY_ROLE[worker]}" \
    node -e "console.log(JSON.stringify({
        name:          process.env.NAME,
        description:   process.env.DESCRIPTION || null,
        imageCombined: process.env.COMBINED,
        imageBackend:  process.env.BACKEND,
        imageWorker:   process.env.WORKER,
    }))")

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "$CONTROL_PLANE_URL/api/admin/releases" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

[ "$STATUS" = "201" ] || [ "$STATUS" = "200" ] || { echo "Announce failed ($STATUS): $BODY" >&2; exit 1; }

echo
echo "Release $NAME announced. Workspaces update from their cards."
