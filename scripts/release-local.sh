#!/usr/bin/env bash
#
# Ships the Pretzel-Graph checkout to the local dev fleet: builds the role
# images into the local docker daemon and announces them as a release, which
# becomes the fleet's latest. Workspaces then update from their cards.
#
#   npm run release:local

set -euo pipefail

CLOUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH="$(cd "$CLOUD/../PretzelGraph" && pwd)"

FLEET_URL="${FLEET_URL:-postgres://fleet_service:service@localhost:5433/fleet}"

SHA=$(git -C "$GRAPH" rev-parse --short HEAD)

# Uncommitted work is the point of a local release; the name says so.
git -C "$GRAPH" diff --quiet || SHA="$SHA-dirty-$(date +%H%M%S)"

VERSION=$(node -p "require('$GRAPH/package.json').version")

# The commit rides along: the same version is built over and over here, and a
# repeated name would be dropped rather than becoming the latest.
NAME="$VERSION+$SHA"

(cd "$GRAPH" && npm run build:images)

# The sha tag, not :latest — a release names bytes, not a moving pointer.
for role in combined backend worker; do
    docker tag "pretzel-graph-$role:latest" "pretzel-graph-$role:$SHA"
done

psql "$FLEET_URL" -v ON_ERROR_STOP=1 -c "
    insert into releases (name, image_combined, image_backend, image_worker)
    values ('$NAME', 'pretzel-graph-combined:$SHA', 'pretzel-graph-backend:$SHA', 'pretzel-graph-worker:$SHA')
    on conflict (name) do nothing" >/dev/null

echo
echo "Release $NAME is the local fleet's latest. Update from the workspace cards."
