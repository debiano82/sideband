const ipam = require('./ipam');
const wg = require('./wgClient');
const provisioning = require('./provisioning');

const WG_SUBNET = process.env.WG_SUBNET || '10.99.0.0/24';
// come trattare la LAN di fabbrica nel provisioning:
// static = IP di gestione fisso, keep = lasciata com'e', off = disabilitata
const LAN_MODES = ['static', 'keep', 'off'];

// schema e utente admin li fa partire index.js dopo il listen (vedi li')

// Niente registrazioni pubbliche: POST /parse/users da fuori creerebbe un
// account con pieno accesso al pannello. Gli utenti nascono solo dal bootstrap
// (ADMIN_USER/ADMIN_PASS) o dalla pagina Utenti, che passa dalla master key.
Parse.Cloud.beforeSave(Parse.User, (req) => {
  if (req.original || req.master) return; // modifica, oppure cloud code/bootstrap
  throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'registrazione pubblica disabilitata');
});

function requireUser(req) {
  if (!req.user && !req.master) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'login richiesto');
}

// --- crea un client + alloca chiavi/IP, registra il peer sul concentratore ---
Parse.Cloud.define('createClient', async (req) => {
  requireUser(req);
  const {
    name, hardwareType = 'rpi', description = '', serialPortCount = 1,
    resetDefaults = true, lanMode = 'static', lanAddress = '192.168.1.1/24',
  } = req.params;
  if (!name) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'nome richiesto');
  if (!LAN_MODES.includes(lanMode)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'lanMode non valido');

  const { nodeIndex, address } = await ipam.allocate(WG_SUBNET);
  const keys = ipam.genKeyPair();

  const Client = Parse.Object.extend('Client');
  const c = new Client();
  c.set({
    name, hardwareType, description,
    wgPublicKey: keys.publicKey,
    wgPrivateKey: keys.privateKey,
    wgAddress: address,
    nodeIndex,
    serialPortCount,
    status: 'new',
    resetDefaults: !!resetDefaults,
    lanMode,
    lanAddress,
  });
  await c.save(null, { useMasterKey: true });

  // porte seriali (default /dev/ttyUSBn, 5000+index)
  const SerialPort = Parse.Object.extend('SerialPort');
  const ports = [];
  for (let i = 0; i < serialPortCount; i++) {
    const sp = new SerialPort();
    sp.set({
      client: c, index: i, label: `porta ${i}`,
      devPath: `/dev/ttyUSB${i}`, tcpPort: 5000 + i, baud: 115200,
    });
    ports.push(sp);
  }
  await Parse.Object.saveAll(ports, { useMasterKey: true });

  // registra il peer sul concentratore WireGuard
  await wg.addPeer(keys.publicKey, `${address}/32`);

  return { id: c.id, address, nodeIndex, ports: ports.length };
});

Parse.Cloud.define('deleteClient', async (req) => {
  requireUser(req);
  const { id } = req.params;
  const c = await new Parse.Query('Client').get(id, { useMasterKey: true });
  try { await wg.removePeer(c.get('wgPublicKey')); } catch (e) { console.error(e.message); }
  const ports = await new Parse.Query('SerialPort').equalTo('client', c).find({ useMasterKey: true });
  await Parse.Object.destroyAll(ports, { useMasterKey: true });
  await c.destroy({ useMasterKey: true });
  return { ok: true };
});

// --- modifica le opzioni di un client (rete / descrizione) ---
Parse.Cloud.define('updateClient', async (req) => {
  requireUser(req);
  const { id, description, resetDefaults, lanMode, lanAddress } = req.params;
  const c = await new Parse.Query('Client').get(id, { useMasterKey: true });
  if (description !== undefined) c.set('description', String(description));
  if (resetDefaults !== undefined) c.set('resetDefaults', !!resetDefaults);
  if (lanMode !== undefined) {
    if (!LAN_MODES.includes(lanMode)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'lanMode non valido');
    c.set('lanMode', lanMode);
  }
  if (lanAddress !== undefined) c.set('lanAddress', String(lanAddress));
  await c.save(null, { useMasterKey: true });
  return { ok: true };
});

// --- script di provisioning OpenWRT ---
Parse.Cloud.define('generateProvisioningScript', async (req) => {
  requireUser(req);
  const { id } = req.params;
  const c = await new Parse.Query('Client').get(id, { useMasterKey: true });
  const ports = await new Parse.Query('SerialPort').equalTo('client', c).ascending('index').find({ useMasterKey: true });
  const server = await wg.serverInfo();
  const script = provisioning.build({
    client: {
      name: c.get('name'),
      wgAddress: c.get('wgAddress'),
      wgPrivateKey: c.get('wgPrivateKey'),
      resetDefaults: c.get('resetDefaults') !== false,
      lanMode: c.get('lanMode') || 'static',
      lanAddress: c.get('lanAddress') || '192.168.1.1/24',
    },
    ports: ports.map((p) => ({ index: p.get('index'), devPath: p.get('devPath'), tcpPort: p.get('tcpPort'), baud: p.get('baud') })),
    server,
  });
  return { filename: `provision-${c.get('name')}.sh`, script };
});

// --- stato VPN: incrocia `wg show` con i Client e aggiorna lastSeen ---
Parse.Cloud.define('vpnStatus', async (req) => {
  requireUser(req);
  const peers = await wg.status();
  const byKey = Object.fromEntries(peers.map((p) => [p.publicKey, p]));
  const clients = await new Parse.Query('Client').limit(1000).find({ useMasterKey: true });
  const rows = clients.map((c) => {
    const p = byKey[c.get('wgPublicKey')] || {};
    const online = p.ageSeconds != null && p.ageSeconds < 180;
    return {
      id: c.id, name: c.get('name'), address: c.get('wgAddress'),
      hardwareType: c.get('hardwareType'),
      online, endpoint: p.endpoint || null,
      ageSeconds: p.ageSeconds ?? null, rx: p.rx || 0, tx: p.tx || 0,
    };
  });
  // aggiorna lastSeen/status in background
  const toUpdate = clients.filter((c) => byKey[c.get('wgPublicKey')]?.ageSeconds < 180);
  toUpdate.forEach((c) => { c.set('status', 'online'); c.set('lastSeen', new Date()); });
  if (toUpdate.length) Parse.Object.saveAll(toUpdate, { useMasterKey: true }).catch(() => {});
  return rows;
});

// --- apertura console: crea Session + ticket monouso per il bridge ---
Parse.Cloud.define('openConsole', async (req) => {
  requireUser(req);
  const { clientId, portIndex } = req.params;
  const c = await new Parse.Query('Client').get(clientId, { useMasterKey: true });
  const sp = await new Parse.Query('SerialPort')
    .equalTo('client', c).equalTo('index', portIndex).first({ useMasterKey: true });
  if (!sp) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'porta non trovata');

  const Session = Parse.Object.extend('Session');
  const s = new Session();
  s.set({ client: c, serialPort: sp, user: req.user, startedAt: new Date() });
  await s.save(null, { useMasterKey: true });

  const ticket = require('crypto').randomBytes(24).toString('hex');
  const Ticket = Parse.Object.extend('ConsoleTicket');
  const t = new Ticket();
  t.set({
    ticket, host: c.get('wgAddress'), port: sp.get('tcpPort'),
    session: s, expiresAt: new Date(Date.now() + 30000),
  });
  await t.save(null, { useMasterKey: true });

  return { ticket };
});

// --- consumo ticket (chiamato dal backend con master key) ---
Parse.Cloud.define('consumeConsoleTicket', async (req) => {
  if (!req.master) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'solo master key');
  const { ticket } = req.params;
  const t = await new Parse.Query('ConsoleTicket').equalTo('ticket', ticket).first({ useMasterKey: true });
  if (!t || t.get('expiresAt') < new Date()) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'ticket scaduto');
  const out = { host: t.get('host'), port: t.get('port'), sessionId: t.get('session').id };
  await t.destroy({ useMasterKey: true }); // monouso
  return out;
});

// ===================== UTENTI =====================

Parse.Cloud.define('listUsers', async (req) => {
  requireUser(req);
  const us = await new Parse.Query(Parse.User).ascending('username').limit(1000).find({ useMasterKey: true });
  return us.map((u) => ({ id: u.id, username: u.get('username'), createdAt: u.createdAt }));
});

Parse.Cloud.define('createUser', async (req) => {
  requireUser(req);
  const { username, password } = req.params;
  if (!username || !password) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'username e password richiesti');
  if (password.length < 6) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'password troppo corta (min 6)');
  const u = new Parse.User();
  u.setUsername(username);
  u.setPassword(password);
  await u.signUp(null, { useMasterKey: true });
  return { id: u.id, username };
});

// reset password di un altro utente (admin)
Parse.Cloud.define('setUserPassword', async (req) => {
  requireUser(req);
  const { userId, newPassword } = req.params;
  if (!newPassword || newPassword.length < 6) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'password troppo corta (min 6)');
  const u = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
  u.setPassword(newPassword);
  await u.save(null, { useMasterKey: true });
  return { ok: true };
});

// cambio della PROPRIA password (con verifica di quella attuale)
Parse.Cloud.define('changeMyPassword', async (req) => {
  if (!req.user) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'login richiesto');
  const { currentPassword, newPassword } = req.params;
  if (!newPassword || newPassword.length < 6) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'password troppo corta (min 6)');
  try {
    await Parse.User.verifyPassword(req.user.get('username'), currentPassword);
  } catch (_e) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'password attuale errata');
  }
  req.user.setPassword(newPassword);
  await req.user.save(null, { useMasterKey: true });
  return { ok: true };
});

Parse.Cloud.define('deleteUser', async (req) => {
  requireUser(req);
  const { userId } = req.params;
  if (req.user && req.user.id === userId) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'non puoi eliminare te stesso');
  const cnt = await new Parse.Query(Parse.User).count({ useMasterKey: true });
  if (cnt <= 1) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'deve restare almeno un utente');
  const u = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
  await u.destroy({ useMasterKey: true });
  return { ok: true };
});

// ===================== PORTE SERIALI =====================

Parse.Cloud.define('addSerialPort', async (req) => {
  requireUser(req);
  const { clientId, label, baud } = req.params;
  const c = await new Parse.Query('Client').get(clientId, { useMasterKey: true });
  const last = await new Parse.Query('SerialPort').equalTo('client', c).descending('index').first({ useMasterKey: true });
  const index = last ? last.get('index') + 1 : 0;
  const SerialPort = Parse.Object.extend('SerialPort');
  const sp = new SerialPort();
  sp.set({
    client: c, index,
    label: label || `porta ${index}`,
    devPath: `/dev/ttyUSB${index}`,
    tcpPort: 5000 + index,
    baud: baud || 115200,
  });
  await sp.save(null, { useMasterKey: true });
  c.increment('serialPortCount');
  await c.save(null, { useMasterKey: true });
  return { id: sp.id, index, tcpPort: 5000 + index };
});

Parse.Cloud.define('updateSerialPort', async (req) => {
  requireUser(req);
  const { portId, label, baud, devPath } = req.params;
  const sp = await new Parse.Query('SerialPort').get(portId, { useMasterKey: true });
  if (label !== undefined) sp.set('label', label);
  if (baud !== undefined) sp.set('baud', parseInt(baud, 10));
  if (devPath !== undefined) sp.set('devPath', devPath);
  await sp.save(null, { useMasterKey: true });
  return { ok: true };
});

Parse.Cloud.define('deleteSerialPort', async (req) => {
  requireUser(req);
  const { portId } = req.params;
  const sp = await new Parse.Query('SerialPort').get(portId, { useMasterKey: true });
  const c = sp.get('client');
  await sp.destroy({ useMasterKey: true });
  if (c) {
    const cc = await new Parse.Query('Client').get(c.id, { useMasterKey: true });
    cc.increment('serialPortCount', -1);
    await cc.save(null, { useMasterKey: true });
  }
  return { ok: true };
});
