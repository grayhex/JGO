# A Debian 13 system container with systemd as PID 1: what a Proxmox LXC looks like to the install script.
ARG BASE=debian:trixie
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
# the packages the Community Scripts engine installs into every container first (curl sudo mc gnupg2 jq)
RUN apt-get update && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus ca-certificates curl sudo mc gnupg2 jq procps iproute2 util-linux file xz-utils openssl \
    && rm -rf /var/lib/apt/lists/* \
    && (cd /lib/systemd/system/sysinit.target.wants && ls | grep -v systemd-tmpfiles-setup | xargs rm -f) \
    && rm -f /lib/systemd/system/multi-user.target.wants/* /etc/systemd/system/*.wants/* \
       /lib/systemd/system/local-fs.target.wants/* /lib/systemd/system/sockets.target.wants/*udev* \
       /lib/systemd/system/sockets.target.wants/*initctl* /lib/systemd/system/basic.target.wants/* \
    && systemctl set-default multi-user.target
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
