/* Sideband: polyfill di crypto.randomUUID per Parse Dashboard.
 *
 * Il bundle del dashboard (Parse JS SDK 8) genera l'installationId con
 * crypto.randomUUID(), che i browser espongono SOLO in "secure context":
 * https, oppure http su localhost/127.0.0.1. Aperto in chiaro su un IP di LAN
 * o su un dominio senza TLS la funzione non esiste e il dashboard si pianta su
 *   "Server not reachable: o.default.crypto.randomUUID is not a function"
 * prima ancora di provare a contattare Parse Server.
 *
 * crypto.getRandomValues invece c'e' anche in chiaro, quindi il UUID v4 resta
 * casuale sul serio. Il polyfill non fa nulla dove randomUUID gia' esiste. */
(function (g) {
  var c = g && g.crypto;
  if (!c || typeof c.randomUUID === 'function') { return; }

  function randomUUID() {
    var b = new Uint8Array(16);
    if (typeof c.getRandomValues === 'function') {
      c.getRandomValues(b);
    } else {
      for (var i = 0; i < 16; i++) { b[i] = Math.floor(Math.random() * 256); }
    }
    b[6] = (b[6] & 0x0f) | 0x40; // versione 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    var h = [];
    for (var j = 0; j < 16; j++) { h.push((b[j] + 0x100).toString(16).slice(1)); }
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
           h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' +
           h.slice(10, 16).join('');
  }

  try {
    c.randomUUID = randomUUID;
  } catch (_e) {
    // istanza Crypto non scrivibile: ci si attacca al prototipo
    Object.defineProperty(Object.getPrototypeOf(c), 'randomUUID', {
      value: randomUUID, configurable: true, writable: true,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
