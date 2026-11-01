#!/bin/sh
set -eu
cert=/certs/server.crt
key=/certs/server.key
if [ -f "$cert" ] && [ -f "$key" ]; then
  openssl x509 -in "$cert" -noout -checkend 0 >/dev/null
  openssl pkey -in "$key" -noout >/dev/null
elif [ -e "$cert" ] || [ -e "$key" ]; then
  echo 'MGO TLS: provide both /certs/server.crt and /certs/server.key' >&2
  exit 1
else
  mkdir -p /certs
  umask 077
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
    -keyout "$key" -out "$cert" -subj '/CN=MGO' \
    -addext "subjectAltName=${MGO_TLS_SAN:-DNS:localhost,IP:127.0.0.1}"
  echo 'MGO HTTPS: created a local certificate. Trust /certs/server.crt on your devices, or install your own trusted certificate.' >&2
fi
