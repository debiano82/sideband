// Parse SDK init — l'app id deve combaciare con .env (PARSE_APP_ID)
Parse.initialize("sideband");
Parse.serverURL = "/parse";

function requireAuth() {
  if (!Parse.User.current()) {
    location.href = "login.html";
    return false;
  }
  return true;
}

async function logout() {
  await Parse.User.logOut();
  location.href = "login.html";
}

function navbar(active) {
  const user = Parse.User.current();
  const link = (href, label) =>
    `<a class="nav-link ${active === href ? "active" : ""}" href="${href}">${label}</a>`;
  return `
  <nav class="navbar navbar-expand px-3 py-2">
    <a class="navbar-brand d-flex align-items-center" href="index.html">
      <img src="assets/logo.svg" alt="Sideband" height="32">
    </a>
    <div class="navbar-nav me-auto ms-3">
      ${link("index.html", "Dashboard")}
      ${link("clients.html", "Client")}
      ${link("users.html", "Utenti")}
    </div>
    <div class="navbar-nav align-items-center">
      <span class="text-muted small me-3">${user ? user.get("username") : ""}</span>
      <button class="btn btn-sm btn-outline-secondary" onclick="logout()">Esci</button>
    </div>
  </nav>`;
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(1) + " " + u[i];
}

function fmtAge(s) {
  if (s == null) return "—";
  if (s < 60) return s + "s fa";
  if (s < 3600) return Math.floor(s / 60) + "m fa";
  return Math.floor(s / 3600) + "h fa";
}
