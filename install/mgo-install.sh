#!/usr/bin/env bash

# Copyright (c) 2026 MGO contributors
# Author: grayhex
# License: MIT | https://github.com/grayhex/MGO/raw/main/LICENSE
# Source: https://github.com/grayhex/MGO

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
useradd --system --home-dir /var/lib/mgo --no-create-home --shell /usr/sbin/nologin mgo
install -d -o mgo -g mgo -m 700 /var/lib/mgo
install -d -o root -g mgo -m 750 /etc/mgo
install -d -o root -g root -m 700 /var/backups/mgo
msg_ok "Created User and Directories"

fetch_and_deploy_gh_release "mgo" "grayhex/MGO" "prebuild" "latest" "/opt/mgo" "mgo-*-linux-amd64.tar.gz"

msg_info "Configuring MGO"
chown -R root:root /opt/mgo
chmod -R go-w /opt/mgo
install -o root -g mgo -m 640 /opt/mgo/share/mgo.env.example /etc/mgo/mgo.env
sed -i "s|^AUTH_TOKEN=.*|AUTH_TOKEN=$(random_password 32)|" /etc/mgo/mgo.env
install -m 644 /opt/mgo/share/systemd/mgo.service /opt/mgo/share/systemd/mgo-xvfb.service /etc/systemd/system/
ln -sf /opt/mgo/bin/mgo /usr/local/bin/mgo
msg_ok "Configured MGO"

if ! runuser -u mgo -- unshare --user --map-current-user --net true 2>/dev/null; then
  sed -i "s|^KEM_LAUNCH_WRAPPER=.*|KEM_LAUNCH_WRAPPER=|" /etc/mgo/mgo.env
  msg_warn "This container cannot create user namespaces (enable Options > Features > Nesting): games will have network access. Use the container firewall, or fix it and run 'mgo network deny'."
fi

msg_info "Creating Service"
systemctl enable -q --now mgo-xvfb mgo
msg_ok "Created Service"

msg_info "Checking MGO"
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:8080/api/health 2>/dev/null | grep -q '"ok":true' && break
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/health | grep -q '"ok":true'
msg_ok "MGO answers on port 8080"

echo -e "${TAB}${INFO}${YW}Access token:${CL} ${BGN}$(sed -n 's/^AUTH_TOKEN=//p' /etc/mgo/mgo.env)${CL}"
echo -e "${TAB}${INFO}${YW}Show it again with 'mgo token'. Keep the container on a private network.${CL}"

motd_ssh
customize
cleanup_lxc
