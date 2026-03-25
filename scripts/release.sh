#!/bin/bash
# Creates a GitHub release with a zip containing only the extension/ folder.
# Usage: ./scripts/release.sh
#
# This script:
# 1. Reads the version from extension/manifest.json
# 2. Creates a zip with only the extension/ folder
# 3. Commits, pushes, and creates a GitHub release with the zip attached

set -e

cd "$(dirname "$0")/.."

# Get version from manifest
VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
TAG="v${VERSION}"
ZIP_NAME="recirculation-tagger-extension.zip"

echo "Releasing version ${VERSION}..."

# Create zip with only the extension folder
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" extension/

# Commit and push any pending changes
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Release ${TAG}"
  echo "Changes committed."
fi
git push

# Delete existing release/tag if it exists (for re-releases)
gh release delete "$TAG" --yes 2>/dev/null || true
git tag -d "$TAG" 2>/dev/null || true
git push origin ":refs/tags/$TAG" 2>/dev/null || true

# Create GitHub release with the zip
gh release create "$TAG" "$ZIP_NAME" \
  --title "Recirculation Tagger ${TAG}" \
  --notes "Download \`${ZIP_NAME}\`, unzip, and load the \`extension\` folder in Chrome."

# Clean up local zip
rm -f "$ZIP_NAME"

echo "Done! Release ${TAG} created: https://github.com/jolmedo-mrf/recirculation-tagger/releases/tag/${TAG}"
