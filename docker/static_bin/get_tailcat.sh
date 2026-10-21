#!/bin/bash
# Fetches the prebuilt static tailcat binary (https://github.com/tailscale/tailcat) for the target arch into /output.
# tailcat is optional (it's only used when the user enables it), so unsupported arches are skipped rather than failing the build.

set -e
set -o pipefail

TAILCAT_VERSION=0.7.0

mkdir -p /output

case "$TARGETARCH${TARGETVARIANT:+/$TARGETVARIANT}" in
    amd64*) arch=amd64 ;;
    arm64*) arch=arm64 ;;
    arm/v7|armv7) arch=armv7 ;;
    *) echo "tailcat: no prebuilt binary for '$TARGETARCH/$TARGETVARIANT', skipping"; exit 0 ;;
esac

archive="tailcat_${TAILCAT_VERSION}_linux_${arch}.tar.gz"
base="https://github.com/tailscale/tailcat/releases/download/v${TAILCAT_VERSION}"

cd "$(mktemp -d)"
curl -fsSLO "$base/$archive"
curl -fsSLO "$base/checksums.txt"
grep " $archive\$" checksums.txt | sha256sum -c -

mkdir -p /output
tar -xzf "$archive" -C /output tailcat
