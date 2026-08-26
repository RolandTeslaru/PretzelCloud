#!/usr/bin/env bash
#
# Builds a workspace image on Fly's x86 builder and pushes it to the app's
# registry, then prints the reference to pin.
#
#   npm run build:image             the combined image
#   npm run build:image backend
#
# The builder is remote on purpose: an image built on an arm64 Mac is refused
# at machine creation with "platform not found: linux/amd64".

set -euo pipefail

ROLE="${1:-combined}"

case "$ROLE" in
    combined|backend|worker) ;;
    *) echo "Unknown role: $ROLE (combined, backend or worker)" >&2; exit 1 ;;
esac

CLOUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH="$(cd "$CLOUD/../PretzelGraph" && pwd)"

[ -f "$CLOUD/.env" ] || { echo "No $CLOUD/.env" >&2; exit 1; }

# The app and region are the control plane's, so they are read rather than
# repeated here.
FLY_APP=$(grep '^FLY_APP=' "$CLOUD/.env" | cut -d= -f2-)
FLY_REGION=$(grep '^FLY_REGION=' "$CLOUD/.env" | cut -d= -f2- || echo fra)

[ -n "$FLY_APP" ] || { echo "FLY_APP is not set in $CLOUD/.env" >&2; exit 1; }

# The tag names a commit, so a tree with uncommitted changes says so.
SHA=$(git -C "$GRAPH" rev-parse --short HEAD)
git -C "$GRAPH" diff --quiet HEAD || SHA="$SHA-dirty"

TAG="$ROLE-$SHA"
IMAGE="registry.fly.io/$FLY_APP:$TAG"

# Only to satisfy `fly deploy`, which refuses to run without app config and
# cannot infer one from an app that has no machines.
CONFIG=$(mktemp -t workspace-image-XXXXXX.toml)
trap 'rm -f "$CONFIG"' EXIT
printf 'app = "%s"\nprimary_region = "%s"\n' "$FLY_APP" "$FLY_REGION" > "$CONFIG"

echo "Building $ROLE from $GRAPH at $SHA"

# Absolute: a relative dockerfile resolves against the config file, not here.
(
    cd "$GRAPH"
    fly deploy --build-only --push --remote-only --yes \
        --config "$CONFIG" \
        --dockerfile "$GRAPH/Dockerfile.$ROLE" \
        --image-label "$TAG"
)

# Retried: the tag is not always readable the instant the push returns.
for attempt in 1 2 3 4 5; do
    DIGEST=$(docker manifest inspect --verbose "$IMAGE" 2>/dev/null \
        | python3 -c 'import sys,json; print(json.load(sys.stdin)["Descriptor"]["digest"])' 2>/dev/null) && break
    sleep 2
done

[ -n "${DIGEST:-}" ] || { echo "Pushed $IMAGE, but could not read its digest" >&2; exit 1; }

echo
echo "Pin this, not the tag — a tag can be pushed over:"
echo
case "$ROLE" in
    combined) echo "  WORKSPACE_IMAGE=registry.fly.io/$FLY_APP@$DIGEST" ;;
    backend)  echo "  WORKSPACE_IMAGE_BACKEND=registry.fly.io/$FLY_APP@$DIGEST" ;;
    worker)   echo "  WORKSPACE_IMAGE_WORKER=registry.fly.io/$FLY_APP@$DIGEST" ;;
esac
