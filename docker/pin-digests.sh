#!/usr/bin/env bash
#
# Pin every `image: <ref>:<tag>` line in docker/docker-compose.yml to its
# resolved sha256 digest, producing reproducible builds for air-gapped /
# regulated deployments.
#
# Usage:
#   ./docker/pin-digests.sh                # print resolved digests to stdout
#   ./docker/pin-digests.sh > docker/digests.lock
#   ./docker/pin-digests.sh --apply        # rewrite docker-compose.yml in place
#
# Requires: docker daemon access (for `docker pull` + `docker inspect`).
# After --apply, COMMIT the modified docker-compose.yml to your fork so the
# pinned digest is part of your reviewed config.
#
# Digests are RegistryDigest values — the same form that
# `docker image inspect <ref> --format '{{index .RepoDigests 0}}'` prints.

set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
APPLY=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker CLI not found in PATH. This script needs a docker daemon to resolve digests." >&2
  exit 1
fi

# Extract every `image: <ref>:<tag>` (skip lines already pinned with @sha256:).
mapfile -t IMAGES < <(
  grep -E '^\s*image:\s+[^@]+:[^@]+\s*$' "$COMPOSE_FILE" \
    | sed -E 's/^\s*image:\s*//; s/\s*$//'
)

if [[ ${#IMAGES[@]} -eq 0 ]]; then
  echo "No unpinned images found in $COMPOSE_FILE — nothing to do." >&2
  exit 0
fi

declare -A DIGESTS
for ref in "${IMAGES[@]}"; do
  echo ">>> Pulling $ref ..." >&2
  docker pull --quiet "$ref" >&2
  digest=$(docker image inspect "$ref" --format '{{index .RepoDigests 0}}' | awk -F'@' '{print $2}')
  if [[ -z "$digest" ]]; then
    echo "ERROR: could not resolve digest for $ref" >&2
    exit 1
  fi
  DIGESTS["$ref"]="$digest"
  echo "$ref@$digest"
done

if [[ "$APPLY" == "true" ]]; then
  TMP=$(mktemp)
  cp "$COMPOSE_FILE" "$TMP"
  for ref in "${!DIGESTS[@]}"; do
    digest="${DIGESTS[$ref]}"
    # Match either "image: <ref>" or "image: <ref> # comment" lines.
    sed -E -i.bak "s|^(\\s*image:\\s+)$ref(\\s*)\$|\\1$ref@$digest\\2|" "$COMPOSE_FILE"
  done
  rm -f "${COMPOSE_FILE}.bak"
  echo "" >&2
  echo "Rewrote $COMPOSE_FILE with pinned digests. Diff vs original:" >&2
  diff -u "$TMP" "$COMPOSE_FILE" >&2 || true
  rm -f "$TMP"
  echo "" >&2
  echo "Commit the change:" >&2
  echo "  git add docker/docker-compose.yml && git commit -m 'pin: docker image digests'" >&2
fi
