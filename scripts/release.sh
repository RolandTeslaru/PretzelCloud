#!/usr/bin/env bash
#
# Ships a release: builds the three roles from the Pretzel-Graph checkout,
# pushes them digest-pinned to the fleet registry, and announces the release to
# the control plane, which mints the row. The manual fallback for the pipeline;
# a release is this one invocation.
#
#   npm run release
#
# Env: FLY_API_TOKEN, AUTH_JWT_SECRET, OPERATOR_USER_ID — read from .env.production
# when not already set. CONTROL_PLANE_URL defaults to production; RELEASE_BRANCH
# to `latest`.

set -euo pipefail

CLOUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH="$(cd "$CLOUD/../PretzelGraph" && pwd)"

env_from_production() {
    grep "^$1=" "$CLOUD/.env.production" | cut -d= -f2- || true
}

FLY_API_TOKEN="${FLY_API_TOKEN:-$(env_from_production FLY_API_TOKEN)}"
AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(env_from_production AUTH_JWT_SECRET)}"
OPERATOR_USER_ID="${OPERATOR_USER_ID:-$(env_from_production OPERATOR_USER_IDS | cut -d, -f1)}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://api.pretzelgraph.ai}"
RELEASE_BRANCH="${RELEASE_BRANCH:-latest}"
FLY_APP="${FLY_APP:-pretzel-workspaces}"

for name in FLY_API_TOKEN AUTH_JWT_SECRET OPERATOR_USER_ID; do
    [ -n "${!name:-}" ] || { echo "$name is not set" >&2; exit 1; }
done

# The announce step's node one-liner reads these from its own environment.
export FLY_API_TOKEN AUTH_JWT_SECRET OPERATOR_USER_ID

BRANCH=$(git -C "$GRAPH" rev-parse --abbrev-ref HEAD)

[ "$BRANCH" = "$RELEASE_BRANCH" ] || { echo "Pretzel-Graph is on '$BRANCH', not '$RELEASE_BRANCH' — check out the release branch first" >&2; exit 1; }

git -C "$GRAPH" diff --quiet || { echo "Pretzel-Graph has uncommitted changes — a release names a commit" >&2; exit 1; }

SHA=$(git -C "$GRAPH" rev-parse --short HEAD)

# The version the manifest declares; bumped in the pull request that ships it.
NAME=$(node -p "require('$GRAPH/package.json').version")

[ -n "$NAME" ] && [ "$NAME" != "undefined" ] || { echo "$GRAPH/package.json declares no version" >&2; exit 1; }

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

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "$CONTROL_PLANE_URL/api/admin/releases" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"imageCombined\":\"${DIGEST_BY_ROLE[combined]}\",\"imageBackend\":\"${DIGEST_BY_ROLE[backend]}\",\"imageWorker\":\"${DIGEST_BY_ROLE[worker]}\"}")

STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

[ "$STATUS" = "201" ] || [ "$STATUS" = "200" ] || { echo "Announce failed ($STATUS): $BODY" >&2; exit 1; }

echo
echo "Release $NAME announced. Workspaces update from their cards."
