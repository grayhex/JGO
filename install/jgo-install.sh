#!/usr/bin/env bash

# Copyright (c) 2026 JGO contributors
# Author: grayhex
# License: MIT | https://github.com/grayhex/JGO/raw/main/LICENSE
# Source: https://github.com/grayhex/JGO

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y \
  openjdk-21-jre-headless \
  xvfb \
  libgl1 \
  libglx-mesa0 \
  libgl1-mesa-dri \
  libegl1 \
  libxext6 \
  libxrender1 \
  libxtst6 \
  libxi6 \
  libxrandr2 \
  libxcursor1 \
  libxinerama1 \
  fontconfig \
  fonts-dejavu-core \
  libharfbuzz0b \
  libfreetype6 \
  libfontconfig1 \
  liblcms2-2
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

msg_info "Creating User and Directories"
useradd --system --home-dir /var/lib/jgo --no-create-home --shell /usr/sbin/nologin jgo
install -d -o jgo -g jgo -m 700 /var/lib/jgo
install -d -o root -g jgo -m 750 /etc/jgo
install -d -o root -g root -m 700 /var/backups/jgo
msg_ok "Created User and Directories"

fetch_and_deploy_gh_release "jgo" "grayhex/JGO" "prebuild" "latest" "/opt/jgo" "jgo-*-linux-amd64.tar.gz"

msg_info "Configuring JGO"
chown -R root:root /opt/jgo
chmod -R go-w /opt/jgo
install -o root -g jgo -m 640 /opt/jgo/share/jgo.env.example /etc/jgo/jgo.env
sed -i "s|^AUTH_TOKEN=.*|AUTH_TOKEN=$(random_password 32)|" /etc/jgo/jgo.env
install -m 644 /opt/jgo/share/systemd/jgo.service /opt/jgo/share/systemd/jgo-xvfb.service /etc/systemd/system/
ln -sf /opt/jgo/bin/jgo /usr/local/bin/jgo
msg_ok "Configured JGO"

msg_info "Creating Service"
systemctl enable -q --now jgo-xvfb jgo
msg_ok "Created Service"

msg_info "Checking JGO"
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:8080/api/health 2>/dev/null | grep -q '"ok":true' && break
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/health | grep -q '"ok":true'
msg_ok "JGO answers on port 8080"

echo -e "${TAB}${INFO}${YW}Access token:${CL} ${BGN}$(sed -n 's/^AUTH_TOKEN=//p' /etc/jgo/jgo.env)${CL}"
echo -e "${TAB}${INFO}${YW}Show it again with 'jgo token'. Keep the container on a private network.${CL}"

motd_ssh
customize
cleanup_lxc
