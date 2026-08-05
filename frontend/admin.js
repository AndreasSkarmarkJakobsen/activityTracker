// Admin token stored in memory only (not localStorage)
let adminToken = null;

// Admin API calls go to the main backend on port 3000
const API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

function showMsg(elId, text, type) {
  const el = document.getElementById(elId);
  el.innerHTML = `<div class="msg ${type}">${text}</div>`;
  setTimeout(() => { el.innerHTML = ""; }, 4000);
}

async function apiRequest(method, path, body) {
  const opts = {
    method,
    headers: { "X-Admin-Token": adminToken, "Content-Type": "application/json" }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function unlock() {
  const token = document.getElementById("token-input").value.trim();
  if (!token) return;
  adminToken = token;
  // Verify token by calling the users endpoint
  const { ok } = await apiRequest("GET", "/api/admin/users");
  if (ok) {
    document.getElementById("lock-section").style.display = "none";
    document.getElementById("admin-section").style.display = "";
    loadUsers();
  } else {
    adminToken = null;
    showMsg("lock-msg", "Invalid token. Check docker compose logs.", "error");
  }
}

async function loadUsers() {
  const listEl = document.getElementById("user-list");
  const { ok, data } = await apiRequest("GET", "/api/admin/users");
  if (!ok) { listEl.textContent = "Failed to load users."; return; }
  if (!data.length) { listEl.textContent = "No users found."; return; }

  listEl.innerHTML = data.map(u => `
    <div class="user-card" id="user-card-${u.id}">
      ${u.avatar
        ? `<img class="user-avatar" src="${API_BASE}${u.avatar}" onerror="this.style.display='none'" />`
        : `<div class="user-avatar"></div>`}
      <div class="user-info">
        <div class="user-name">${escHtml(u.username)}</div>
        <div class="user-id">ID: ${u.id}</div>
      </div>
      <div class="user-actions">
        <button class="btn-secondary" onclick="showPasswordForm(${u.id})">🔑 Set Password</button>
        <button class="btn-danger" onclick="deleteUser(${u.id}, '${escHtml(u.username)}')">🗑️ Delete</button>
      </div>
    </div>
    <div id="pw-form-${u.id}" style="display:none;padding:0 0 0.8rem 0.5rem;">
      <div class="inline-pw">
        <input type="password" id="pw-input-${u.id}" placeholder="New password" />
        <button class="btn-primary" onclick="setPassword(${u.id})">Save</button>
        <button class="btn-secondary" onclick="hidePasswordForm(${u.id})">Cancel</button>
      </div>
      <div id="pw-msg-${u.id}"></div>
    </div>
  `).join("");
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showPasswordForm(id) {
  document.getElementById(`pw-form-${id}`).style.display = "";
  document.getElementById(`pw-input-${id}`).focus();
}
function hidePasswordForm(id) {
  document.getElementById(`pw-form-${id}`).style.display = "none";
}

async function setPassword(id) {
  const pw = document.getElementById(`pw-input-${id}`).value;
  if (!pw) return;
  const { ok, data } = await apiRequest("PUT", `/api/admin/users/${id}/password`, { password: pw });
  if (ok) {
    showMsg(`pw-msg-${id}`, "Password updated.", "success");
    document.getElementById(`pw-input-${id}`).value = "";
  } else {
    showMsg(`pw-msg-${id}`, data.error || "Failed to update password.", "error");
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}" and all their data? This cannot be undone.`)) return;
  const { ok, data } = await apiRequest("DELETE", `/api/admin/users/${id}`);
  if (ok) {
    showMsg("global-msg", `User "${username}" deleted.`, "success");
    loadUsers();
  } else {
    showMsg("global-msg", data.error || "Failed to delete user.", "error");
  }
}

// Allow Enter key to unlock
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("token-input").addEventListener("keydown", e => {
    if (e.key === "Enter") unlock();
  });
});
