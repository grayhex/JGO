# shellcheck shell=bash
# Shared helpers for the build scripts (source this file).

# javac_checked <javac args...>
# Runs javac, prints its diagnostics without the harmless JAVA_TOOL_OPTIONS / deprecation noise,
# and returns javac's own exit status. (A `javac ... | grep -v ... || true` pipeline would hide
# compile errors: the pipeline's status is grep's, not javac's.)
javac_checked() {
  local out status
  out="$(mktemp)"
  set +e
  javac "$@" >"$out" 2>&1
  status=$?
  set -e
  grep -v '^Note:\|JAVA_TOOL_OPTIONS\|^warning: \[options\]' "$out" || true
  rm -f "$out"
  if [ "$status" -ne 0 ]; then
    echo "javac failed with exit status $status" >&2
  fi
  return "$status"
}
