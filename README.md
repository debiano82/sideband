# Sideband

Accesso console seriale **out-of-band** ad apparati di rete (router, switch, qualsiasi
console seriale di gestione) tramite client OpenWRT remoti raggiunti via **WireGuard**.

```
apparato  --seriale-->  client OpenWRT (ser2net)  --WireGuard-->  concentratore  --web/xterm-->  browser
```

## Architettura (v1)

| Servizio    | Ruolo |
|-------------|-------|
| `mongo`     | database |
| `parse`     | Parse Server 7 (porta interna **PARSE_PORT**, default 4000) + cloud code, **serve il pannello** e proxa `/ws` |
| `backend`   | concentratore WireGuard (`wg0`) + helper API + **bridge seriale websocket** |
| `dashboard` | Parse Dashboard (admin interno) |

Niente nginx: hai un Nginx Proxy Manager davanti. Il pannello (HTML/Bootstrap/JS + xterm.js)
è servito da Parse stesso (porta `PARSE_PORT`, default 4000), che proxa anche il websocket `/ws` verso il `backend`.
Così NPM ha un unico upstream (`parse:${PARSE_PORT}`) sia per `app` che per `api`. La porta è configurabile in `.env`.

Il `backend` tiene l'interfaccia `wg0`: trovandosi nello stesso namespace di rete,
il bridge seriale raggiunge direttamente le porte `ser2net` dei client sulla overlay.
`parse` resta non privilegiato e pilota WireGuard via API interna (`HELPER_TOKEN`).

## DNS / Nginx Proxy Manager

Tutto su `sideband.it`, terzo livello:

| Sottodominio        | Punta a (NPM)      | Note |
|---------------------|--------------------|------|
| `app.sideband.it`   | `parse:<PARSE_PORT>` | pannello (**abilita Websockets Support** in NPM per `/ws`) |
| `api.sideband.it`   | `parse:<PARSE_PORT>` | Parse Server (`/parse`) |
| `dash.sideband.it`  | `dashboard:4040`   | Parse Dashboard |
| `vpn.sideband.it`   | **record A** → IP pubblico host | endpoint WireGuard UDP/51820 |

`app` e `api` puntano allo stesso upstream `parse:<PARSE_PORT>` (porta interna impostata in `.env`, default 4000).
Su `app` attiva il toggle **Websockets Support** in NPM, serve per la console seriale.

`vpn.sideband.it` finisce dentro ogni config client: tienilo stabile (cambi solo il
record A se sposti il concentratore, senza rigenerare i client).

## Avvio

```sh
cp .env.example .env       # imposta i secret (master key, helper token, ecc.)
docker compose up -d --build
docker compose logs -f backend   # annota la pubkey del concentratore al primo avvio
```

Sul `docker-compose.yml`, tre cose da sapere:

- **`BIND_ADDR` decide dove si affacciano pannello e dashboard.** Di default `127.0.0.1`:
  l'unica porta davvero esposta e' `51820/udp` del concentratore WireGuard. Se il
  pannello non risponde, e' quasi sempre questo:

  | Dov'e' NPM | Cosa fare |
  |------------|-----------|
  | container Docker su una rete sua | lascia `127.0.0.1` e collega i servizi alla rete esterna di NPM (esempio in fondo al compose): NPM li raggiunge come `parse:4000` e `dashboard:4040` |
  | sull'host, o in `network_mode: host` | `BIND_ADDR=127.0.0.1` va gia' bene |
  | nessun NPM / accesso diretto in test | `BIND_ADDR=0.0.0.0` — attenzione, cosi' il pannello e' in chiaro e senza TLS |
- **Il pannello e' un bind mount** (`./web/html` → `/app/public`, read-only): non sta
  dentro l'immagine, quindi lo modifichi senza rebuild.
- **Il volume `wg-config` e' critico**: contiene la chiave privata del concentratore e i
  peer salvati da `wg-quick save`. Se lo cancelli la pubkey cambia e *tutti* i client
  vanno riprovvisionati. Va nei backup.

### Primo utente admin

Non serve nessun curl: l'utente del pannello lo crea Parse all'avvio, leggendo
il `.env`.

```ini
ADMIN_USER=admin
ADMIN_PASS=una-password-vera   # minimo 6 caratteri
```

`docker compose up -d` e basta. Il bootstrap e' idempotente e rigira a ogni
avvio del servizio `parse`:

| situazione | cosa fa |
|---|---|
| utente assente | lo crea |
| presente, password uguale al `.env` | non tocca niente |
| presente, password diversa | la riallinea a quella del `.env` |

Quindi **il `.env` e' sempre la verita'**: se ti chiudi fuori, cambi `ADMIN_PASS`,
`docker compose restart parse` e rientri. Nel log lo vedi:

```
[admin] creato utente "admin"
[admin] utente "admin" gia' presente, password invariata
[admin] password di "admin" riallineata al .env
```

Gli altri utenti si creano dalla pagina *Utenti* del pannello. La registrazione
pubblica (`POST /parse/users` da fuori) e' **disabilitata**: senza, chiunque
arrivi a `api.sideband.it` potrebbe aprirsi un account con pieno accesso.

Poi accedi a `app.sideband.it` (o `http://localhost:${PARSE_PORT}` in locale).

### Parse Dashboard

Due variabili nel `.env`:

- `DASH_USER` / `DASH_PASS` — il login del dashboard (non c'entra con l'utente
  del pannello).
- `DASHBOARD_API_URL` — l'URL di Parse che deve aprire **il browser dell'admin**,
  non quello interno. In locale `http://localhost:4000/parse`, dietro NPM lo stesso
  valore di `PUBLIC_API_URL`. Se e' sbagliato o non raggiungibile, il dashboard
  dice *"Server not reachable"*.

Se il dashboard lo apri **in chiaro su un host che non e' localhost** (es.
`http://192.168.1.10:4040` o un dominio senza TLS), il browser non espone
`crypto.randomUUID`, che il bundle usa per l'installationId, e l'errore e':

```
Server not reachable: o.default.crypto.randomUUID is not a function
```

Per questo il servizio `dashboard` non usa l'immagine ufficiale nuda ma la
estende con un polyfill (`./dashboard`). Con TLS davanti il polyfill non entra
nemmeno in gioco.


## Flusso d'uso

1. **Client → Nuovo client**: assegna nome, hardware, numero porte seriali e le
   opzioni di rete del nodo (vedi *Configurazione di fabbrica* qui sotto).
   Il server genera coppia di chiavi WG, alloca l'IP, registra il peer.
2. **Scarica script provisioning** dalla scheda client → eseguilo sull'OpenWRT.
3. Il client compone il tunnel; in **Dashboard** compare online.
4. **Apri console** su una porta → terminale xterm.js nel browser.

**Utenti** (pagina *Utenti*): cambia la tua password, crea altri utenti, resetta la loro password.
**Porte seriali** (scheda client): aggiungi/elimina porte e modifica baudrate ed etichetta; dopo le
modifiche riscarica lo script provisioning (o aggiorna `/etc/ser2net.yaml` sul client) e riavvia ser2net.

## Configurazione di fabbrica OpenWrt

Il provisioning **ripulisce la configurazione di default** del nodo, perche' un client
out-of-band non deve comportarsi da router domestico (se finisce sulla rete del cliente
con il DHCP attivo la rompe). Nel dettaglio:

- elimina tutte le sezioni `config dhcp` di `/etc/config/dhcp` → **nessun lease DHCPv4**;
- ferma e disabilita **odhcpd** (DHCPv6 + Router Advertisement);
- rimuove il forwarding `lan → wan` e il **masquerading** sulla zona `wan`;
- cancella l'`ula_prefix` generato al primo boot.

**dnsmasq resta attivo**: senza pool non assegna piu' indirizzi, ma serve come resolver
locale del nodo — spegnendolo si perderebbe la risoluzione DNS e con essa l'endpoint
WireGuard, l'NTP e i repository dei pacchetti.

La LAN si gestisce con l'opzione **LAN di gestione** (scheda client, modificabile anche
dopo la creazione):

| Modalita' | Effetto |
|-----------|---------|
| `static` (default) | LAN con IP fisso (default `192.168.1.1/24`), senza DHCP: resta una via di accesso locale |
| `keep`             | interfaccia `lan` lasciata com'e', viene tolto solo il DHCP server |
| `off`              | `lan` disabilitata: si amministra solo via WireGuard (recupero locale solo in failsafe) |

L'intera pulizia si disattiva togliendo la spunta **Ripulisci la configurazione di fabbrica**.

> Lo script termina con `network restart`: se lo lanci da SSH sulla LAN con un indirizzo
> DHCP perdi la sessione. Eseguilo da console seriale, o assegnati prima un IP statico.

## Package manager: opkg e apk

OpenWrt e' passato ad **apk** da 24.10 (e su `main`); le release precedenti usano **opkg**.
Lo script generato rileva a runtime quale dei due e' presente (`command -v apk`) e passa
per i wrapper `pkg_update` / `pkg_install` / `pkg_installed` / `pkg_install_opt`.
I pacchetti essenziali (`wireguard-tools`, `kmod-wireguard`, `ser2net`) fanno fallire lo
script se mancano; quelli opzionali (`mwan3`, i `kmod-usb-serial-*`, `luci-proto-wireguard`)
vengono installati uno a uno e se assenti sulla board producono solo un warning.

## Note v1 / TODO

- **Naming seriale**: lo script installa l'hotplug che crea symlink stabili in
  `/dev/sideband/<path-usb>`. ser2net parte agganciato a `/dev/ttyUSB0..N`; una volta
  nota la topologia fisica del sito, ripuntare i `connector` ser2net ai symlink stabili
  (i CH340 spesso non hanno seriale → si lega per posizione USB).
- **mwan3**: installato ma da configurare con le WAN del sito (eth DHCP / VLAN OOB / LTE).
- **Firewall**: la pulizia toglie il NAT `lan → wan`. Se un sito usa il nodo anche come
  router di backup, imposta la LAN su `keep` e rimetti forwarding/masquerading a mano.
- **Sicurezza**: ser2net ascolta solo sull'IP `wg0`; `HELPER_TOKEN` e `MASTER_KEY` vanno
  cambiati. Mettere il pannello dietro HTTPS (NPM) — i ticket console sono monouso (30s).
- **Trasporto VPN** astratto su `wgClient`: ZeroTier/Tailscale aggiungibili più avanti.
