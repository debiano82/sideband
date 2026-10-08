let resetTarget = null;

async function load() {
  const users = await Parse.Cloud.run("listUsers");
  const me = Parse.User.current();
  document.getElementById("rows").innerHTML = users
    .map((u) => {
      const isMe = me && u.id === me.id;
      return `
    <tr>
      <td>${u.username} ${isMe ? '<span class="badge bg-light text-dark">tu</span>' : ""}</td>
      <td class="small text-muted">${new Date(u.createdAt).toLocaleDateString("it-IT")}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary" onclick="askReset('${u.id}','${u.username}')">Reset password</button>
        ${isMe ? "" : `<button class="btn btn-sm btn-outline-danger ms-1" onclick="delU('${u.id}','${u.username}')">Elimina</button>`}
      </td>
    </tr>`;
    })
    .join("");
}

async function changeMine() {
  const msg = document.getElementById("cp-msg");
  const cur = document.getElementById("cp-cur").value;
  const n1 = document.getElementById("cp-new").value;
  const n2 = document.getElementById("cp-new2").value;
  msg.className = "small mt-2";
  msg.textContent = "";
  if (n1 !== n2) { msg.classList.add("text-danger"); msg.textContent = "Le due nuove password non coincidono."; return; }
  try {
    await Parse.Cloud.run("changeMyPassword", { currentPassword: cur, newPassword: n1 });
    msg.classList.add("text-success");
    msg.textContent = "Password aggiornata. Verrai riportato al login.";
    setTimeout(async () => { await Parse.User.logOut(); location.href = "login.html"; }, 1200);
  } catch (e) {
    msg.classList.add("text-danger");
    msg.textContent = e.message;
  }
}

async function createU() {
  const username = document.getElementById("nu-user").value.trim();
  const password = document.getElementById("nu-pass").value;
  try {
    await Parse.Cloud.run("createUser", { username, password });
    bootstrap.Modal.getInstance(document.getElementById("newUser")).hide();
    document.getElementById("nu-user").value = "";
    document.getElementById("nu-pass").value = "";
    load();
  } catch (e) { alert("Errore: " + e.message); }
}

function askReset(id, name) {
  resetTarget = id;
  document.getElementById("rp-name").textContent = name;
  document.getElementById("rp-pass").value = "";
  new bootstrap.Modal(document.getElementById("resetPw")).show();
}

async function doReset() {
  const newPassword = document.getElementById("rp-pass").value;
  try {
    await Parse.Cloud.run("setUserPassword", { userId: resetTarget, newPassword });
    bootstrap.Modal.getInstance(document.getElementById("resetPw")).hide();
  } catch (e) { alert("Errore: " + e.message); }
}

async function delU(id, name) {
  if (!confirm(`Eliminare l'utente "${name}"?`)) return;
  try { await Parse.Cloud.run("deleteUser", { userId: id }); load(); }
  catch (e) { alert("Errore: " + e.message); }
}

if (requireAuth()) {
  document.getElementById("nav").innerHTML = navbar("users.html");
  load();
}
