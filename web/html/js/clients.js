async function load() {
  const q = new Parse.Query("Client");
  q.ascending("nodeIndex");
  q.limit(1000);
  const clients = await q.find();
  document.getElementById("rows").innerHTML =
    clients
      .map(
        (c) => `
    <tr>
      <td><a href="client.html?id=${c.id}">${c.get("name")}</a></td>
      <td class="mono">${c.get("wgAddress")}</td>
      <td>${c.get("hardwareType") || "—"}</td>
      <td>${c.get("serialPortCount") || 0}</td>
      <td><span class="badge bg-light text-dark">${c.get("status")}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" onclick="del('${c.id}','${c.get("name")}')">Elimina</button>
      </td>
    </tr>`
      )
      .join("") ||
    `<tr><td colspan="6" class="text-muted p-3">Nessun client.</td></tr>`;
}

async function create() {
  const name = document.getElementById("f-name").value.trim();
  if (!name) return;
  const btn = document.getElementById("f-submit");
  btn.disabled = true;
  btn.textContent = "Creo...";
  try {
    await Parse.Cloud.run("createClient", {
      name,
      hardwareType: document.getElementById("f-hw").value,
      description: document.getElementById("f-desc").value.trim(),
      serialPortCount: parseInt(document.getElementById("f-ports").value, 10) || 1,
      resetDefaults: document.getElementById("f-reset").checked,
      lanMode: document.getElementById("f-lanmode").value,
      lanAddress: document.getElementById("f-lanaddr").value.trim() || "192.168.1.1/24",
    });
    bootstrap.Modal.getInstance(document.getElementById("newModal")).hide();
    document.getElementById("f-name").value = "";
    load();
  } catch (e) {
    alert("Errore: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Crea client";
  }
}

// l'indirizzo serve solo in modalita' statica
function toggleLanAddr() {
  document.getElementById("f-lanaddr").disabled =
    document.getElementById("f-lanmode").value !== "static";
}

async function del(id, name) {
  if (!confirm(`Eliminare "${name}"? Il peer WireGuard verrà rimosso.`)) return;
  try {
    await Parse.Cloud.run("deleteClient", { id });
    load();
  } catch (e) {
    alert("Errore: " + e.message);
  }
}

if (requireAuth()) {
  document.getElementById("nav").innerHTML = navbar("clients.html");
  load();
}
