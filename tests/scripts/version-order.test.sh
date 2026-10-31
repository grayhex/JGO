#!/usr/bin/env bash
# `jgo update` must order versions like semver: a beta is older than its release (plain `sort -V` gets that wrong).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck disable=SC1090
source <(sed -n '/^version_gt()/,/^}/p' packaging/bin/jgo)
fail=0
check() { # check <a> <b> <gt|le>
  local got=le
  if version_gt "$1" "$2"; then got=gt; fi
  if [[ $got != "$3" ]]; then echo "FAIL: $1 vs $2 is $got, want $3"; fail=1; fi
}
check 0.1.0 0.1.0-beta.1 gt
check 0.1.0-beta.1 0.1.0 le
check 0.1.0-beta.2 0.1.0-beta.1 gt
check 0.1.0-beta.10 0.1.0-beta.9 gt
check 0.1.0-rc.1 0.1.0-beta.3 gt
check 0.1.1-beta.1 0.1.0 gt
check 0.2.0 0.1.9 gt
check 0.1.0 0.1.0 le
((fail == 0)) && echo "version order ok"
exit "$fail"
