#!/usr/bin/env bash
_CS_DEFAULT_URL="https://raw.githubusercontent.com/grayhex/JGO/main"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2026 JGO contributors
# Author: grayhex
# License: MIT | https://github.com/grayhex/JGO/raw/main/LICENSE
# Source: https://github.com/grayhex/JGO

APP="JGO"
var_tags="${var_tags:-games;emulator;java}"
var_cpu="${var_cpu:-4}"
var_ram="${var_ram:-4096}"
var_disk="${var_disk:-20}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"
var_arm64="${var_arm64:-no}" # the release ships an x86_64 supervisor and x86_64 LWJGL natives

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/jgo ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  if check_for_gh_release "jgo" "grayhex/JGO"; then
    msg_info "Updating JGO"
    $STD jgo update --yes --to "$CHECK_UPDATE_RELEASE"
    msg_ok "Updated JGO to ${CHECK_UPDATE_RELEASE}"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL:${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:8080${CL}"
echo -e "${INFO}${YW}Access token: pct exec ${CTID} -- jgo token  (also printed at the end of the install)${CL}"
