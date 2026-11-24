#!/bin/sh
# Builds dist/ from public/ (plain ES modules, no bundler).
#   ./build.sh          build
#   ./build.sh check    build + syntax-check every JS file
#   ./build.sh dev      build, then run the Worker locally at http://127.0.0.1:8850 (rooms + art proxy included)
#   ./build.sh deploy   build, then publish to https://crate.rennko.tech (Cloudflare Workers)
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist && cp -R public/. dist/
echo "Built dist/"
case "$1" in
  check) for f in $(find public worker -name '*.js'); do node --check "$f" || exit 1; done; echo "Syntax OK" ;;
  dev) npx -y wrangler@4 dev --port 8850 --ip 127.0.0.1 ;;
  deploy) npx -y wrangler@4 deploy ;;
esac
