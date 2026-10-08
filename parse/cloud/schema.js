// Bootstrap idempotente dello schema: aggiunge solo i campi mancanti.
const defs = {
  Client: {
    name: 'String',
    hardwareType: 'String',      // rpi | bananapi | generic
    description: 'String',
    wgPublicKey: 'String',
    wgPrivateKey: 'String',
    wgAddress: 'String',         // es 10.99.0.2
    nodeIndex: 'Number',
    serialPortCount: 'Number',
    status: 'String',            // new | online | offline
    lastSeen: 'Date',
    resetDefaults: 'Boolean',    // ripulisce la config di fabbrica OpenWrt (DHCP server, NAT)
    lanMode: 'String',           // static | keep | off
    lanAddress: 'String',        // CIDR della LAN di gestione, es 192.168.1.1/24
  },
  SerialPort: {
    client: 'Pointer<Client>',
    index: 'Number',
    label: 'String',
    devPath: 'String',           // /dev/ttyUSB0 oppure /dev/sideband/<path>
    tcpPort: 'Number',           // 5000 + index
    baud: 'Number',
  },
  VpnPeer: {
    client: 'Pointer<Client>',
    publicKey: 'String',
    endpoint: 'String',
    latestHandshake: 'Number',
    ageSeconds: 'Number',
    rx: 'Number',
    tx: 'Number',
  },
  Session: {
    client: 'Pointer<Client>',
    serialPort: 'Pointer<SerialPort>',
    user: 'Pointer<_User>',
    startedAt: 'Date',
    endedAt: 'Date',
  },
  ConsoleTicket: {
    ticket: 'String',
    host: 'String',
    port: 'Number',
    session: 'Pointer<Session>',
    expiresAt: 'Date',
  },
};

async function ensureSchema() {
  for (const [className, fields] of Object.entries(defs)) {
    const schema = new Parse.Schema(className);
    let existing = null;
    try {
      // senza master key la get fallisce e al riavvio si ritenterebbe di
      // creare una classe che esiste gia'
      const got = await schema.get({ useMasterKey: true });
      existing = got.fields || {};
    } catch (_e) {
      // classe non ancora esistente
    }
    let changed = false;
    for (const [field, type] of Object.entries(fields)) {
      if (existing && existing[field]) continue;
      changed = true;
      if (type.startsWith('Pointer<')) {
        schema.addPointer(field, type.slice(8, -1));
      } else {
        schema['add' + type](field);
      }
    }
    if (!existing) {
      await schema.save({ useMasterKey: true });
      console.log(`[schema] creata classe ${className}`);
    } else if (changed) {
      await schema.update({ useMasterKey: true });
      console.log(`[schema] aggiornata classe ${className}`);
    }
  }
}

module.exports = { ensureSchema };
