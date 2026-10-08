const HELPER_URL = process.env.HELPER_URL || 'http://backend:8080';
const TOKEN = process.env.HELPER_TOKEN;

async function call(method, pathname, body) {
  const r = await fetch(`${HELPER_URL}${pathname}`, {
    method,
    headers: { 'X-Helper-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`helper ${pathname}: ${r.status} ${t}`);
  }
  return r.json();
}

module.exports = {
  serverInfo: () => call('GET', '/helper/serverinfo'),
  status: () => call('GET', '/helper/status'),
  addPeer: (publicKey, allowedIps) => call('POST', '/helper/peer', { publicKey, allowedIps }),
  removePeer: (publicKey) => call('DELETE', `/helper/peer/${encodeURIComponent(publicKey)}`),
};
