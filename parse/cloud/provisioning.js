// Genera lo script di provisioning OpenWRT per un Client.
// Riempie il template con chiavi, indirizzo WG, endpoint server e porte seriali.
// Lo script generato funziona sia su OpenWrt con opkg (<= 23.05) sia con apk (>= 24.10 / main).

function ser2netYaml(ports, wgIp) {
  // ser2net v4 (YAML). Una connection per seriale, in ascolto SOLO sull'IP WG.
  return ports
    .map(
      (p) => `connection: &sb${p.index}
  accepter: tcp,${wgIp},${p.tcpPort}
  connector: serialdev,${p.devPath},${p.baud || 115200}n81,local
  options:
    kickolduser: true
    max-connections: 1`
    )
    .join('\n');
}

// "192.168.1.1/24" -> { ipaddr: '192.168.1.1', netmask: '255.255.255.0' }
function parseCidr(cidr, fallback = '192.168.1.1/24') {
  const [ip, prefixStr] = String(cidr || fallback).trim().split('/');
  const prefix = Math.min(32, Math.max(0, parseInt(prefixStr, 10) || 24));
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const netmask = [24, 16, 8, 0].map((s) => (mask >>> s) & 0xff).join('.');
  return { ipaddr: ip || '192.168.1.1', netmask };
}

// Astrazione opkg/apk: OpenWrt 24.10+ e main usano apk, le release precedenti opkg.
const PKG_HELPERS = `# ---------- package manager: apk (OpenWrt >= 24.10) oppure opkg ----------
if command -v apk >/dev/null 2>&1; then PKG=apk; else PKG=opkg; fi
echo "[*] package manager rilevato: $PKG"

pkg_update() {
  case "$PKG" in
    apk)  apk update ;;
    opkg) opkg update ;;
  esac
}

pkg_install() {
  case "$PKG" in
    apk)  apk add "$@" ;;
    opkg) opkg install "$@" ;;
  esac
}

pkg_installed() {
  case "$PKG" in
    apk)  apk info -e "$1" >/dev/null 2>&1 ;;
    opkg) opkg list-installed 2>/dev/null | grep -q "^$1 " ;;
  esac
}

# pacchetti opzionali: un kmod assente su una board non deve far fallire tutto
pkg_install_opt() {
  for p in "$@"; do
    if pkg_installed "$p"; then continue; fi
    pkg_install "$p" >/dev/null 2>&1 || echo "[!] pacchetto opzionale non installato: $p"
  done
}`;

// Pulizia della configurazione di fabbrica OpenWrt.
// Nota: dnsmasq resta attivo come *resolver* locale (senza di lui il nodo perde
// la risoluzione DNS e non risolve piu' l'endpoint WireGuard/NTP); quello che
// viene rimosso e' il suo ruolo di server DHCP, insieme a odhcpd (DHCPv6/RA).
function resetSection({ lanMode, lanAddress }) {
  const lan = parseCidr(lanAddress);

  let lanBlock;
  if (lanMode === 'keep') {
    lanBlock = `# LAN lasciata come da configurazione esistente (rimosso solo il DHCP server)`;
  } else if (lanMode === 'off') {
    // la board potrebbe non avere affatto una sezione `lan`: non e' un errore
    lanBlock = `# LAN disabilitata: il nodo si amministra solo via WireGuard
# (recupero locale: failsafe mode - OpenWrt boot + tasto reset)
if uci -q get network.lan >/dev/null 2>&1; then
  uci set network.lan.disabled="1"
else
  echo "[!] nessuna interfaccia lan da disabilitare"
fi`;
  } else {
    lanBlock = `# LAN come sola porta di gestione locale: IP statico, nessun servizio
if uci -q get network.lan >/dev/null 2>&1; then
  uci set network.lan.proto="static"
  uci set network.lan.ipaddr="${lan.ipaddr}"
  uci set network.lan.netmask="${lan.netmask}"
  uci -q delete network.lan.disabled || true
  uci -q delete network.lan.ip6assign || true
  uci -q delete network.lan.dns || true
  uci -q delete network.lan.gateway || true
else
  echo "[!] nessuna interfaccia lan: salto la riconfigurazione"
fi`;
  }

  return `# ---------- rimozione configurazione di fabbrica OpenWrt ----------
# Un nodo out-of-band non deve distribuire lease ne' fare da router:
# se finisce sulla rete del cliente con il DHCP attivo la rompe.
echo "[*] rimuovo la configurazione di default (DHCP server, ruolo router)"

# 1) server DHCP: elimina tutti i pool (config dhcp) e la sezione odhcpd
for s in $(uci -q show dhcp | sed -n 's/^dhcp\\.\\([^.=]*\\)=\\(dhcp\\|odhcpd\\)$/\\1/p'); do
  echo "    - dhcp.$s"
  uci -q delete "dhcp.$s"
done
uci -q commit dhcp

# odhcpd (DHCPv6 + Router Advertisement) va spento del tutto
if [ -x /etc/init.d/odhcpd ]; then
  /etc/init.d/odhcpd stop >/dev/null 2>&1 || true
  /etc/init.d/odhcpd disable >/dev/null 2>&1 || true
fi
# dnsmasq resta acceso: serve come resolver locale del nodo (endpoint WG, NTP,
# repo pacchetti). Senza pool configurati non assegna piu' alcun indirizzo.
[ -x /etc/init.d/dnsmasq ] && /etc/init.d/dnsmasq restart >/dev/null 2>&1 || true

# 2) niente ruolo router: via forwarding lan->wan e masquerading
while uci -q get firewall.@forwarding[0] >/dev/null 2>&1; do
  uci -q delete firewall.@forwarding[0]
done
i=0
while uci -q get firewall.@zone[$i] >/dev/null 2>&1; do
  if [ "$(uci -q get firewall.@zone[$i].name)" = "wan" ]; then
    uci -q set firewall.@zone[$i].masq="0"
  fi
  i=$((i+1))
done

# 3) IPv6 di fabbrica (ULA generata al primo boot, usata solo dalla delega LAN)
uci -q delete network.globals.ula_prefix || true

# 4) interfaccia LAN
${lanBlock}

uci commit network
uci commit firewall`;
}

function build({ client, ports, server }) {
  const wgIp = client.wgAddress;
  const [host, port] = (server.endpoint || 'vpn.sideband.it:51820').split(':');
  const serverNet = '10.99.0.0/24';
  const yaml = ser2netYaml(ports, wgIp);
  const resetDefaults = client.resetDefaults !== false;
  const reset = resetDefaults
    ? resetSection({ lanMode: client.lanMode || 'static', lanAddress: client.lanAddress })
    : '# ---------- configurazione di fabbrica lasciata intatta (resetDefaults=false) ----------';

  return `#!/bin/sh
# ============================================================
# Sideband - provisioning client OpenWRT
# Client : ${client.name}
# Nodo   : ${wgIp}  ->  ${host}:${port}
# Generato: ${new Date().toISOString()}
#
# ATTENZIONE: lo script riavvia la rete alla fine e ${
    resetDefaults ? 'rimuove il DHCP server di fabbrica' : 'riconfigura le interfacce'
  }.
# Se sei collegato via LAN con un indirizzo DHCP perderai la sessione:
# lancialo da seriale/console, o assegnati un IP statico prima.
# ============================================================
set -e

# ---------- clock valido (Pi senza RTC: la verifica TLS dei repo fallisce) ----------
if [ "$(date +%Y)" -lt 2024 ]; then
  echo "[*] orologio non valido, sincronizzo via NTP"
  ntpd -q -p pool.ntp.org || ntpd -q -p time.cloudflare.com || \\
    echo "[!] NTP non raggiungibile: imposta la data a mano (date -s) e rilancia"
fi

${PKG_HELPERS}

echo "[*] aggiorno gli indici dei pacchetti"
pkg_update

echo "[*] installo i pacchetti richiesti"
pkg_install wireguard-tools kmod-wireguard ser2net

echo "[*] installo i pacchetti opzionali (kmod seriali, mwan3, LuCI)"
pkg_install_opt mwan3 \\
  kmod-usb-serial kmod-usb-serial-ftdi kmod-usb-serial-ch341 \\
  kmod-usb-serial-pl2303 kmod-usb-serial-cp210x
if pkg_installed luci-base; then pkg_install_opt luci-proto-wireguard; fi

${reset}

# ---------- WireGuard ----------
echo "[*] configuro WireGuard"
uci -q delete network.wg0 || true
uci set network.wg0="interface"
uci set network.wg0.proto="wireguard"
uci set network.wg0.private_key="${client.wgPrivateKey}"
uci add_list network.wg0.addresses="${wgIp}/32"

uci -q delete network.wgserver || true
uci set network.wgserver="wireguard_wg0"
uci set network.wgserver.public_key="${server.publicKey}"
uci set network.wgserver.endpoint_host="${host}"
uci set network.wgserver.endpoint_port="${port}"
uci set network.wgserver.persistent_keepalive="25"
uci add_list network.wgserver.allowed_ips="${serverNet}"
uci set network.wgserver.route_allowed_ips="1"
uci commit network

# ---------- firewall: zona wg (gestione dal concentratore) ----------
echo "[*] firewall"
uci -q delete firewall.sb_wg || true
uci set firewall.sb_wg="zone"
uci set firewall.sb_wg.name="wg"
uci set firewall.sb_wg.input="ACCEPT"
uci set firewall.sb_wg.output="ACCEPT"
uci set firewall.sb_wg.forward="REJECT"
uci add_list firewall.sb_wg.network="wg0"
uci commit firewall

# ---------- naming seriale stabile (per path USB fisico) ----------
# crea symlink in /dev/sideband/<path>; aggancia poi ser2net a questi
# se vuoi pinnare le porte indipendentemente dall'ordine di enumerazione.
mkdir -p /etc/hotplug.d/tty
cat > /etc/hotplug.d/tty/20-sideband <<'HOTPLUG'
[ "$ACTION" = "add" ] || exit 0
case "$DEVICENAME" in
  ttyUSB*)
    mkdir -p /dev/sideband
    name="$(echo "$DEVPATH" | sed 's#.*/usb[0-9]*/##; s#/#-#g')"
    ln -sf "/dev/$DEVICENAME" "/dev/sideband/$name"
  ;;
esac
HOTPLUG

# ---------- ser2net ----------
echo "[*] ser2net"
cat > /etc/ser2net.yaml <<'SER2NET'
${yaml}
SER2NET

# ser2net fa il bind sull'IP di wg0: riavvialo quando l'interfaccia sale
# (al boot wg0 potrebbe non avere ancora l'indirizzo)
mkdir -p /etc/hotplug.d/iface
cat > /etc/hotplug.d/iface/99-sideband-ser2net <<'IFACE'
[ "$ACTION" = "ifup" ] && [ "$INTERFACE" = "wg0" ] && /etc/init.d/ser2net restart
IFACE

/etc/init.d/ser2net enable
/etc/init.d/ser2net restart

# ---------- mwan3 (multi-WAN failover) ----------
# Le WAN sono specifiche del sito (eth DHCP, VLAN OOB, modem LTE):
# configura le interfacce e poi abilita mwan3. Esempio minimale:
if [ -x /etc/init.d/mwan3 ]; then
  echo "[*] mwan3 abilitato (configura le WAN del sito)"
  /etc/init.d/mwan3 enable || true
fi

# ---------- up ----------
/etc/init.d/firewall restart
/etc/init.d/network restart
echo ""
echo "[ok] ${client.name} configurato."
echo "     WG ${wgIp} -> ${host}:${port}"
echo "     porte seriali: ${ports.map((p) => p.tcpPort).join(', ')}"
`;
}

module.exports = { build, parseCidr };
