const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');
const wg = require('./wg');

const PORT = 8080;
const TOKEN = process.env.HELPER_TOKEN;
const PARSE_URL = process.env.PARSE_SERVER_URL;
const APP_ID = process.env.PARSE_APP_ID;
const MASTER_KEY = process.env.PARSE_MASTER_KEY;

const app = express();
app.use(express.json());

// --- API helper, solo rete interna, protetta da token condiviso ---
function auth(req, res, next) {
  if (req.headers['x-helper-token'] !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/helper/serverinfo', auth, async (_req, res) => {
  try { res.json(await wg.serverInfo()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/helper/peer', auth, async (req, res) => {
  try {
    const { publicKey, allowedIps } = req.body;
    if (!publicKey || !allowedIps) return res.status(400).json({ error: 'publicKey e allowedIps richiesti' });
    await wg.addPeer(publicKey, allowedIps);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/helper/peer/:pub', auth, async (req, res) => {
  try { await wg.removePeer(decodeURIComponent(req.params.pub)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/helper/status', auth, async (_req, res) => {
  try { res.json(await wg.status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// --- bridge seriale websocket ---
// il browser ottiene un ticket monouso da Parse (cloud openConsole) e lo passa qui.
async function consumeTicket(ticket) {
  const url = `${PARSE_URL}/functions/consumeConsoleTicket`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Parse-Application-Id': APP_ID,
      'X-Parse-Master-Key': MASTER_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ticket }),
  });
  if (!r.ok) throw new Error('ticket non valido');
  const j = await r.json();
  return j.result; // { host, port, sessionId }
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/console' });

wss.on('connection', async (ws, req) => {
  const ticket = new URL(req.url, 'http://x').searchParams.get('ticket');
  let target;
  try {
    target = await consumeTicket(ticket);
  } catch (e) {
    ws.send(`\r\n[sideband] ${e.message}\r\n`);
    return ws.close();
  }

  ws.send(`\r\n[sideband] connessione a ${target.host}:${target.port} ...\r\n`);
  const sock = net.connect(target.port, target.host);

  sock.on('connect', () => ws.send(`[sideband] console aperta\r\n`));
  sock.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d));
  sock.on('error', (e) => { ws.readyState === ws.OPEN && ws.send(`\r\n[sideband] errore: ${e.message}\r\n`); ws.close(); });
  sock.on('close', () => ws.readyState === ws.OPEN && ws.close());

  ws.on('message', (m) => sock.writable && sock.write(m));
  ws.on('close', () => sock.destroy());
});

server.listen(PORT, () => console.log(`[backend] helper+bridge su :${PORT}`));
