const express = require('express');
const path = require('path');
const { ParseServer } = require('parse-server');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { ensureSchema } = require('./cloud/schema');
const { ensureAdmin } = require('./cloud/bootstrap');

const {
  PARSE_APP_ID = 'sideband',
  PARSE_MASTER_KEY = 'change-me-master-key',
  PUBLIC_API_URL = 'http://localhost:4000/parse',
  BACKEND_URL = 'http://backend:8080',
} = process.env;

const PARSE_PORT = parseInt(process.env.PARSE_PORT, 10) || 4000;

const MONGO_URI = process.env.DATABASE_URI || 'mongodb://mongo:27017/sideband';

// Dentro il cloud code l'SDK Parse parla col server via HTTP su `serverURL`:
// se ci mettiamo l'URL pubblico, tutto cio' che passa di li' (es. Parse.Schema
// nel bootstrap) dipende da NPM/DNS e muore appena il giro esterno non risponde.
// Quindi serverURL resta interno e l'URL pubblico va in publicServerURL.
const INTERNAL_API_URL = `http://127.0.0.1:${PARSE_PORT}/parse`;

async function main() {
  const api = new ParseServer({
    databaseURI: MONGO_URI,
    appId: PARSE_APP_ID,
    masterKey: PARSE_MASTER_KEY,
    serverURL: INTERNAL_API_URL,
    publicServerURL: PUBLIC_API_URL,
    cloud: path.join(__dirname, 'cloud', 'main.js'),
    allowClientClassCreation: false,
    masterKeyIps: ['0.0.0.0/0', '::/0'], // rete docker interna
  });
  await api.start();

  const app = express();

  // Parse Server (porta interna = PARSE_PORT, mount /parse)
  app.use('/parse', api.app);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // proxy del bridge seriale websocket verso il backend (stesso origin del pannello)
  const wsProxy = createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    ws: true,
  });
  app.use('/ws', wsProxy);

  // pannello statico (HTML/Bootstrap/JS) servito da Parse stesso
  app.use(express.static(path.join(__dirname, 'public')));

  const server = app.listen(PARSE_PORT, async () => {
    console.log(`[parse] :${PARSE_PORT}  ->  /parse, /ws, pannello`);
    // dopo il listen: Parse.Schema passa dall'HTTP interno, che prima non c'e' ancora
    try { await ensureSchema(); } catch (e) { console.error('[schema]', e.message); }
    try { await ensureAdmin(); } catch (e) { console.error('[admin]', e.message); }
  });
  server.on('upgrade', wsProxy.upgrade); // handshake websocket
}

main().catch((e) => { console.error(e); process.exit(1); });
