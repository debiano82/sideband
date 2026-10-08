const params = new URLSearchParams(location.search);
const clientId = params.get("id");
let term, ws;

const BAUDS = [9600, 19200, 38400, 57600, 115200];
let clientAddr = "";

async function load() {
  const c = await new Parse.Query("Client").get(clientId);
  clientAddr = c.get("wgAddress");
  document.getElementById("c-name").textContent = c.get("name");
  document.getElementById("c-meta").innerHTML =
    `<span class="mono">${c.get("wgAddress")}</span> · ${c.get("hardwareType")} · ${c.get("status")}`;
  if (c.get("description"))
    document.getElementById("c-desc").textContent = c.get("description");

  document.getElementById("n-reset").checked = c.get("resetDefaults") !== false;
  document.getElementById("n-lanmode").value = c.get("lanMode") || "static";
  document.getElementById("n-lanaddr").value = c.get("lanAddress") || "192.168.1.1/24";
  toggleLanAddr();

  const ports = await new Parse.Query("SerialPort")
    .equalTo("client", c).ascending("index").find();

  document.getElementById("ports").innerHTML = ports
    .map((p) => {
      const id = p.id;
      const baud = p.get("baud") || 115200;
      const opts = BAUDS.map((b) => `<option value="${b}" ${b === baud ? "selected" : ""}>${b}</option>`).join("");
      return `
    <tr>
      <td>${p.get("index")}</td>
      <td><input class="form-control form-control-sm" value="${p.get("label") || ""}"
            onchange="updPort('${id}','label',this.value)"></td>
      <td><input class="form-control form-control-sm mono" style="min-width:150px" value="${p.get("devPath")}"
            onchange="updPort('${id}','devPath',this.value)"></td>
      <td class="mono">${clientAddr}:${p.get("tcpPort")}</td>
      <td><select class="form-select form-select-sm" style="width:auto"
            onchange="updPort('${id}','baud',this.value)">${opts}</select></td>
      <td class="text-end">
        <button class="btn btn-sm btn-primary" onclick="openConsole(${p.get("index")},'${(p.get("label") || "").replace(/'/g, "")}')">Console</button>
        <button class="btn btn-sm btn-outline-danger ms-1" onclick="delPort('${id}')">×</button>
      </td>
    </tr>`;
    })
    .join("") ||
    `<tr><td colspan="6" class="text-muted">Nessuna porta. Aggiungine una.</td></tr>`;
}

// l'indirizzo serve solo in modalita' statica
function toggleLanAddr() {
  document.getElementById("n-lanaddr").disabled =
    document.getElementById("n-lanmode").value !== "static";
}

async function saveNet() {
  toggleLanAddr();
  try {
    await Parse.Cloud.run("updateClient", {
      id: clientId,
      resetDefaults: document.getElementById("n-reset").checked,
      lanMode: document.getElementById("n-lanmode").value,
      lanAddress: document.getElementById("n-lanaddr").value.trim() || "192.168.1.1/24",
    });
  } catch (e) {
    alert("Errore: " + e.message);
    load();
  }
}

async function addPort() {
  try { await Parse.Cloud.run("addSerialPort", { clientId }); load(); }
  catch (e) { alert("Errore: " + e.message); }
}

async function updPort(portId, field, value) {
  try { await Parse.Cloud.run("updateSerialPort", { portId, [field]: value }); }
  catch (e) { alert("Errore: " + e.message); }
}

async function delPort(portId) {
  if (!confirm("Eliminare questa porta seriale?")) return;
  try { await Parse.Cloud.run("deleteSerialPort", { portId }); load(); }
  catch (e) { alert("Errore: " + e.message); }
}

async function downloadScript() {
  try {
    const r = await Parse.Cloud.run("generateProvisioningScript", { id: clientId });
    const blob = new Blob([r.script], { type: "text/x-shellscript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = r.filename;
    a.click();
  } catch (e) {
    alert("Errore: " + e.message);
  }
}

async function openConsole(portIndex, label) {
  document.getElementById("term-title").textContent = "Console · " + label;
  const modal = new bootstrap.Modal(document.getElementById("termModal"));
  modal.show();

  const el = document.getElementById("term");
  el.innerHTML = "";
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    convertEol: true,          // \n -> \r\n (evita l'effetto scaletta)
    scrollback: 5000,
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    theme: { background: "#0f172a" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();
  term.focus();

  const onResize = () => { try { fit.fit(); } catch (_e) {} };
  window.addEventListener("resize", onResize);
  // ridimensiona quando la modale ha finito l'animazione
  setTimeout(onResize, 250);

  let ticket;
  try {
    const r = await Parse.Cloud.run("openConsole", { clientId, portIndex });
    ticket = r.ticket;
  } catch (e) {
    term.write(`\r\n[errore] ${e.message}\r\n`);
    return;
  }

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/console?ticket=${ticket}`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) =>
    term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
  ws.onclose = () => term.write("\r\n[sideband] sessione chiusa\r\n");
  term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(d));

  document.getElementById("termModal").addEventListener(
    "hidden.bs.modal",
    () => {
      window.removeEventListener("resize", onResize);
      if (ws) ws.close();
      if (term) term.dispose();
    },
    { once: true }
  );
}

if (requireAuth()) {
  document.getElementById("nav").innerHTML = navbar("clients.html");
  load();
}
