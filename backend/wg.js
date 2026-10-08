const { execFile } = require('child_process');
const fs = require('fs');

const IFACE = 'wg0';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.toString());
    });
  });
}

async function serverInfo() {
  const publicKey = fs.readFileSync('/etc/wireguard/server.pub', 'utf8').trim();
  return { publicKey, endpoint: process.env.WG_ENDPOINT };
}

async function addPeer(publicKey, allowedIps) {
  await run('wg', ['set', IFACE, 'peer', publicKey, 'allowed-ips', allowedIps]);
  await run('wg-quick', ['save', IFACE]);
}

async function removePeer(publicKey) {
  await run('wg', ['set', IFACE, 'peer', publicKey, 'remove']);
  await run('wg-quick', ['save', IFACE]);
}

// `wg show wg0 dump` -> una riga per peer (la prima e' l'interfaccia)
async function status() {
  const out = await run('wg', ['show', IFACE, 'dump']);
  const lines = out.trim().split('\n').slice(1).filter(Boolean);
  return lines.map((l) => {
    const [publicKey, , endpoint, allowedIps, hs, rx, tx] = l.split('\t');
    const handshake = parseInt(hs, 10) || 0;
    return {
      publicKey,
      endpoint: endpoint === '(none)' ? null : endpoint,
      allowedIps,
      latestHandshake: handshake,
      ageSeconds: handshake ? Math.floor(Date.now() / 1000) - handshake : null,
      rx: parseInt(rx, 10) || 0,
      tx: parseInt(tx, 10) || 0,
    };
  });
}

module.exports = { serverInfo, addPeer, removePeer, status };
