#!/bin/bash
# Save clipboard content as a report in the reports/ directory.
# Extracts domain and page type from the report header.
#
# Usage:
#   ./scripts/save-report.sh          # reads from clipboard
#   pbpaste | ./scripts/save-report.sh -   # reads from stdin

set -euo pipefail

REPORTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/reports"

# Read content from clipboard or stdin
if [[ "${1:-}" == "-" ]]; then
  content="$(cat)"
else
  content="$(pbpaste)"
fi

if [[ -z "$content" ]]; then
  echo "Error: clipboard is empty" >&2
  exit 1
fi

# Extract URL and page type from report header
url=$(echo "$content" | grep -m1 '^\*\*URL:\*\*' | sed 's/\*\*URL:\*\* *//')
page_type=$(echo "$content" | grep -m1 '^\*\*Page type:\*\*' | sed 's/\*\*Page type:\*\* *//')

if [[ -z "$url" || -z "$page_type" ]]; then
  echo "Error: could not parse report header (missing URL or Page type)" >&2
  echo "Make sure clipboard contains a valid Recirculation Tagging Report" >&2
  exit 1
fi

# Extract domain from URL
domain=$(echo "$url" | sed -E 's|https?://||; s|^www\.||; s|/.*||')

if [[ -z "$domain" || "$domain" == "(unknown)" ]]; then
  echo "Error: could not extract domain from URL: $url" >&2
  exit 1
fi

# Build filename: domain - Homepage.md or domain - Article.md
if [[ "$page_type" == "Home" ]]; then
  label="Homepage"
else
  label="Article"
fi

filename="${domain} - ${label}.md"
filepath="${REPORTS_DIR}/${filename}"

mkdir -p "$REPORTS_DIR"
echo "$content" > "$filepath"

echo "Saved: reports/${filename}"
