#!/usr/bin/env bash
# Regression test: compile errors must fail the build scripts (they used to be swallowed by `| grep ... || true`).
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
. "$root/runtime/scripts/lib.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

printf 'class Good { }\n' >"$tmp/Good.java"
printf 'class Bad { int x = "not an int"; }\n' >"$tmp/Bad.java"

( set -e; javac_checked -d "$tmp/out" "$tmp/Good.java" ) >/dev/null 2>&1
check "javac_checked passes on valid source" "[ $? -eq 0 ]"
( set -e; javac_checked -d "$tmp/out" "$tmp/Bad.java" ) >/dev/null 2>&1
check "javac_checked fails on a compile error" "[ $? -ne 0 ]"

# the fixture build script must fail too (broken source dir)
mkdir -p "$tmp/fx/src/kemtest" "$tmp/api"
cp "$tmp/Bad.java" "$tmp/fx/src/kemtest/Bad.java"
mkdir -p "$tmp/fx/tests/fixtures/testmidlet" "$tmp/fx/runtime/scripts"
cp "$root/tests/fixtures/testmidlet/build.sh" "$tmp/fx/tests/fixtures/testmidlet/build.sh"
cp "$root/runtime/scripts/lib.sh" "$tmp/fx/runtime/scripts/lib.sh"
mkdir -p "$tmp/fx/tests/fixtures/testmidlet/src" && mv "$tmp/fx/src/kemtest" "$tmp/fx/tests/fixtures/testmidlet/src/kemtest"
bash "$tmp/fx/tests/fixtures/testmidlet/build.sh" "$tmp/api" "$tmp/out.jar" >/dev/null 2>&1
check "fixture build.sh exits non-zero when the MIDlet does not compile" "[ $? -ne 0 ] && [ ! -f '$tmp/out.jar' ]"
exit $fail
