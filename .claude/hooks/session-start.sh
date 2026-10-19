#!/bin/bash
# Installs dependencies at the start of a cloud session, so a nightly routine
# can run `npm run check` and `npm run test:e2e` without setting anything up.
set -euo pipefail

# Locally, dependencies are the developer's business.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Until M0 lands there is nothing to install.
if [ ! -f package.json ]; then
  exit 0
fi

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
