#!/bin/bash

set -e

copyfiles -u 1 src/**/*.js dist/

tsc

# Dashboard (Vite) -> dist/dashboard. Imports src/dashboard/protocol.ts, so it must see src/.
yarn --cwd dashboard install --frozen-lockfile --network-timeout 1000000
yarn --cwd dashboard build
