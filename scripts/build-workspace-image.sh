#!/usr/bin/env bash
#
# Builds a workspace image on Fly's x86 builder, pushes it to the app's
# registry, and records the digest it pushed in the environment file.
#
#   npm run build:images            every role
#   npm run build:image             the combined image
#   npm run build:image backend
#
# The builder is remote on purpose: an image built on an arm64 Mac is refused
# at machine creation with "platform not found: linux/amd64".

set -euo pipefail

ROLES="${1:-combined}"

[ "$ROLES" = "all" ] && ROLES="combined backend worker"

for role in $ROLES; do
    case "$role" in
        combined|backend|worker) ;;
        *) echo "Unknown role: $role (combined, backend, worker or all)" >&2; exit 1 ;;
    esac
done

CLOUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPH="$(cd "$CLOUD/../PretzelGraph" && pwd)"

[ -f "$CLOUD/.env" ] || { echo "No $CLOUD/.env" >&2; exit 1; }

# The app and region are the control plane's, so they are read rather than
# repeated here.
FLY_APP=$(grep '^FLY_APP=' "$CLOUD/.env" | cut -d= -f2-)
FLY_REGION=$(grep '^FLY_REGION=' "$CLOUD/.env" | cut -d= -f2- || echo fra)

[ -n "$FLY_APP" ] || { echo "FLY_APP is not set in $CLOUD/.env" >&2; exit 1; }

# Where the digests are recorded. The Fly file by default, since a Docker
# deployment names images rather than pinning them.
ENV_FILE="${ENV_FILE:-$CLOUD/.env.fly}"

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE to record digests in" >&2; exit 1; }

# The tag names a commit, so a tree with uncommitted changes says so.
SHA=$(git -C "$GRAPH" rev-parse --short HEAD)
git -C "$GRAPH" diff --quiet HEAD || SHA="$SHA-dirty"

# Only to satisfy `fly deploy`, which refuses to run without app config and
# cannot infer one from an app that has no machines.
CONFIG=$(mktemp -t workspace-image-XXXXXX.toml)
trap 'rm -f "$CONFIG"' EXIT
printf 'app = "%s"\nprimary_region = "%s"\n' "$FLY_APP" "$FLY_REGION" > "$CONFIG"

get_env_key_for_role() {
    case "$1" in
        combined) echo WORKSPACE_IMAGE ;;
        backend)  echo WORKSPACE_IMAGE_BACKEND ;;
        worker)   echo WORKSPACE_IMAGE_WORKER ;;
    esac
}

# Replaces the line in place, or appends it when the key is new.
write_env_var() {
    python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import io, sys

path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]

lines = io.open(path, encoding='utf-8').read().splitlines(keepends=True)

replaced = False

for index, line in enumerate(lines):
    if line.startswith(f'{key}='):
        lines[index] = f'{key}={value}\n'
        replaced = True
        break

if not replaced:
    if lines and not lines[-1].endswith('\n'):
        lines.append('\n')
    lines.append(f'{key}={value}\n')

io.open(path, 'w', encoding='utf-8').write(''.join(lines))
PY
}

build_role() {
    role=$1
    tag="$role-$SHA"
    image="registry.fly.io/$FLY_APP:$tag"

    echo "Building $role from $GRAPH at $SHA"

    # Absolute: a relative dockerfile resolves against the config file, not here.
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

    [ -n "$digest" ] || { echo "Pushed $image, but could not read its digest" >&2; exit 1; }

    key=$(get_env_key_for_role "$role")
    write_env_var "$key" "registry.fly.io/$FLY_APP@$digest"

    echo "  $key recorded in $(basename "$ENV_FILE")"
}

for role in $ROLES; do
    build_role "$role"
done

echo
echo "Rebuild a workspace's machines to pick these up."
