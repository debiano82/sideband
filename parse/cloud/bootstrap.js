// Bootstrap del primo utente admin.
//
// Il pannello non ha una pagina di registrazione (e la signup pubblica e'
// disabilitata in main.js): senza questo, dopo un `docker compose up` il
// database e' vuoto e non si entra. Qui l'utente nasce all'avvio di Parse
// leggendo ADMIN_USER / ADMIN_PASS dal .env.
//
// E' idempotente e gira a ogni avvio:
//   - utente assente        -> lo crea
//   - presente, password ok -> non tocca niente
//   - presente, password no -> la riallinea a quella del .env
//
// Quindi il .env e' sempre la verita': se ti chiudi fuori, cambi ADMIN_PASS,
// `docker compose restart parse` e rientri.

const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS = process.env.ADMIN_PASS || '';

async function ensureAdmin() {
  if (!ADMIN_USER || !ADMIN_PASS) {
    console.warn('[admin] ADMIN_USER/ADMIN_PASS non impostati nel .env: bootstrap saltato');
    return;
  }
  if (ADMIN_PASS.length < 6) {
    console.error('[admin] ADMIN_PASS troppo corta (min 6 caratteri): bootstrap saltato');
    return;
  }

  const existing = await new Parse.Query(Parse.User)
    .equalTo('username', ADMIN_USER)
    .first({ useMasterKey: true });

  if (!existing) {
    const u = new Parse.User();
    u.setUsername(ADMIN_USER);
    u.setPassword(ADMIN_PASS);
    await u.signUp(null, { useMasterKey: true });
    console.log(`[admin] creato utente "${ADMIN_USER}"`);
    return;
  }

  // gia' presente: verifico la password prima di riscriverla, cosi' i restart
  // non rigenerano l'hash inutilmente e il log dice cosa e' successo
  try {
    await Parse.User.verifyPassword(ADMIN_USER, ADMIN_PASS, { useMasterKey: true });
    console.log(`[admin] utente "${ADMIN_USER}" gia' presente, password invariata`);
  } catch (_e) {
    existing.setPassword(ADMIN_PASS);
    await existing.save(null, { useMasterKey: true });
    console.log(`[admin] password di "${ADMIN_USER}" riallineata al .env`);
  }
}

module.exports = { ensureAdmin };
