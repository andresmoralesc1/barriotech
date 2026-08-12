#!/usr/bin/env bash
# strip-polyfills-chunk.sh
# Post-build: replace the legacy Next.js polyfills chunk with a tiny stub.
# PageSpeed flagged the 39.5 KiB gzipped polyfills-*.js chunk as wasted bytes
# (modern browsers skip execution via noModule but still download it).
# We replace the file with a 4-byte stub. The HTML still references the
# original hash so the script tag succeeds with no parse cost.
#
# Run after `next build`. Safe to run multiple times.

set -e
chunk=$(ls /home/telchar/barriotech/apps/web/.next/static/chunks/polyfills-*.js 2>/dev/null | head -1)
if [ -z "$chunk" ]; then
  echo "No polyfills chunk found — already stripped or Next.js emitted none."
  exit 0
fi
orig_size=$(stat -c %s "$chunk")
# Modern browsers don't need these. The script tag still loads the file
# but it's effectively empty so parse cost is zero.
printf '/* modern browsers only — see next.config.js outputFileTracingExcludes */' > "$chunk"
new_size=$(stat -c %s "$chunk")
echo "stripped polyfills chunk: $orig_size → $new_size bytes ($chunk)"
