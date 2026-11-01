#!/usr/bin/env bash
# Dev mode: API on :8080 (tsx watch) + Vite on :5173 (proxying /api). Open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")/../.."
trap 'kill 0' EXIT
npm run dev -w @mgo/api &
npm run dev -w @mgo/web &
wait
