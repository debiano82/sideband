const nacl = require('tweetnacl');

// chiavi WireGuard (Curve25519) generate lato Parse senza binario wg
function genKeyPair() {
  const kp = nacl.box.keyPair();
  return {
    privateKey: Buffer.from(kp.secretKey).toString('base64'),
    publicKey: Buffer.from(kp.publicKey).toString('base64'),
  };
}

// alloca il prossimo indice nodo libero -> indirizzo nella /24 (server = .1)
async function allocate(subnet) {
  const base = (subnet || '10.99.0.0/24').split('/')[0].split('.').slice(0, 3).join('.');
  const q = new Parse.Query('Client');
  q.descending('nodeIndex');
  q.limit(1);
  const last = await q.first({ useMasterKey: true });
  const nodeIndex = last && last.get('nodeIndex') ? last.get('nodeIndex') + 1 : 1;
  const address = `${base}.${nodeIndex + 1}`; // .2 in su
  return { nodeIndex, address };
}

module.exports = { genKeyPair, allocate };
