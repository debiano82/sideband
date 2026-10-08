async function load() {
  let rows = [];
  try {
    rows = await Parse.Cloud.run("vpnStatus");
  } catch (e) {
    document.getElementById("rows").innerHTML =
      `<tr><td colspan="6" class="text-danger p-3">Errore: ${e.message}</td></tr>`;
    return;
  }

  const online = rows.filter((r) => r.online).length;
  document.getElementById("c-total").textContent = rows.length;
  document.getElementById("c-online").textContent = online;
  document.getElementById("c-offline").textContent = rows.length - online;

  document.getElementById("rows").innerHTML =
    rows
      .map(
        (r) => `
    <tr>
      <td><span class="dot ${r.online ? "dot-on" : "dot-off"}"></span>
          <a href="client.html?id=${r.id}">${r.name}</a></td>
      <td class="mono">${r.address}</td>
      <td>${r.hardwareType || "—"}</td>
      <td class="mono small">${r.endpoint || "—"}</td>
      <td>${fmtAge(r.ageSeconds)}</td>
      <td class="small text-muted">↓${fmtBytes(r.rx)} ↑${fmtBytes(r.tx)}</td>
    </tr>`
      )
      .join("") ||
    `<tr><td colspan="6" class="text-muted p-3">Nessun client. Creane uno nella sezione Client.</td></tr>`;
}

if (requireAuth()) {
  document.getElementById("nav").innerHTML = navbar("index.html");
  load();
  setInterval(load, 10000);
}
