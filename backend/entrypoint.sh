#!/bin/sh
set -e

WG_DIR=/etc/wireguard
CONF="$WG_DIR/wg0.conf"
SERVER_IP="$(echo "${WG_SUBNET:-10.99.0.0/24}" | sed 's#0/.*#1#')"   # .1 della subnet
PREFIX="$(echo "${WG_SUBNET:-10.99.0.0/24}" | cut -d/ -f2)"

if [ ! -f "$CONF" ]; then
  echo "[entrypoint] genero la coppia di chiavi del concentratore"
  umask 077
  priv="$(wg genkey)"
  pub="$(echo "$priv" | wg pubkey)"
  echo "$pub" > "$WG_DIR/server.pub"
  cat > "$CONF" <<EOF
[Interface]
Address = ${SERVER_IP}/${PREFIX}
ListenPort = 51820
PrivateKey = ${priv}
SaveConfig = true
EOF
  echo "[entrypoint] server pubkey: $pub"
fi

echo "[entrypoint] wg-quick up wg0"
wg-quick up wg0 || wg-quick up "$CONF"

exec node server.js
