const API = "/api";
let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function authHeaders() { return { Authorization: `Bearer ${token}` }; }

function clearSession() {
  token = null; currentUser = null;
  localStorage.removeItem("token");
  localStorage.removeItem("currentUser");
}

/* ---------- Initials fallback avatar (deterministic color + first 2 letters) ---------- */
function hashStringToHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}
function getAvatarUrl(user) {
  if (user && user.avatar) return user.avatar;
  const username = (user && user.username) || "??";
  const initials = username.slice(0, 2).toUpperCase();
  const hue = hashStringToHue(username);
  const bg = `hsl(${hue}, 60%, 45%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" rx="50" fill="${bg}"/>
    <text x="50" y="54" font-size="40" fill="#fff" text-anchor="middle" font-family="-apple-system, Arial, sans-serif" font-weight="600">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

document.getElementById("show-register").onclick = e => { e.preventDefault(); showView("register-view"); };
document.getElementById("show-login").onclick = e => { e.preventDefault(); showView("login-view"); };

document.getElementById("login-form").onsubmit = async e => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const res = await fetch(`${API}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Login failed");
  token = data.token; currentUser = data.user;
  localStorage.setItem("token", token);
  localStorage.setItem("currentUser", JSON.stringify(currentUser));
  enterDashboard();
};

let regAvatarFile = null;
document.getElementById("reg-avatar").onchange = e => {
  regAvatarFile = e.target.files[0];
  if (!regAvatarFile) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById("reg-avatar-preview");
    preview.src = ev.target.result; preview.hidden = false;
  };
  reader.readAsDataURL(regAvatarFile);
};

document.getElementById("register-form").onsubmit = async e => {
  e.preventDefault();
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);
  if (regAvatarFile) formData.append("avatar", regAvatarFile);

  const res = await fetch(`${API}/register`, { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Registration failed");
  token = data.token; currentUser = data.user;
  localStorage.setItem("token", token);
  localStorage.setItem("currentUser", JSON.stringify(currentUser));
  enterDashboard();
};

document.getElementById("logout-btn").onclick = () => {
  clearSession();
  showView("login-view");
};

async function enterDashboard() {
  document.getElementById("welcome-msg").textContent = `Hi, ${currentUser.username}!`;
  showView("dashboard-view");
  await renderLeaderboard();
  await renderCarousel();
}

async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`, { headers: authHeaders() });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return null;
  }
  return res.json();
}

/* ---------- Leaderboard: stat cards + ranked list ---------- */
async function renderLeaderboard() {
  const data = await fetchLeaderboard();
  if (!data) return;

  const sorted = [...data]
    .map(u => ({ ...u, activity_count: Number(u.activity_count) }))
    .sort((a, b) => b.activity_count - a.activity_count);

  const totalWorkouts = sorted.reduce((sum, u) => sum + u.activity_count, 0);
  const maxCount = sorted.length ? sorted[0].activity_count : 0;

  // Stat cards: current user's rank + total workouts across everyone.
  const myIndex = sorted.findIndex(u => currentUser && Number(u.id) === Number(currentUser.id));
  document.getElementById("stat-rank").textContent = myIndex >= 0 ? `#${myIndex + 1}` : "#-";
  document.getElementById("stat-rank-sub").textContent = `Out of ${sorted.length}`;
  document.getElementById("stat-total").textContent = totalWorkouts;
  document.getElementById("stat-total-sub").textContent = "This month";

  const list = document.getElementById("leaderboard-list");
  list.innerHTML = "";

  // Standard competition ranking (1224 style): a user's rank is
  // 1 + the number of people with a strictly higher count. Users with the
  // same count share the same rank. A medal is only ever awarded when the
  // rank is 1, 2, or 3 AND exactly one person occupies that rank (no tie)
  // AND their count is greater than 0 - so if everyone (or the top group)
  // is tied, nobody gets a medal.
  const ranks = sorted.map(u => {
    const higher = sorted.filter(other => other.activity_count > u.activity_count).length;
    return higher + 1;
  });
  const rankGroupSize = rank => ranks.filter(r => r === rank).length;

  sorted.forEach((u, i) => {
    const rank = ranks[i];
    const isMe = currentUser && Number(u.id) === Number(currentUser.id);
    const isUniqueRank = rankGroupSize(rank) === 1 && u.activity_count > 0;

    const rankClass = rank <= 3 ? rank : "other";
    const badgeHtml = `<span class="rank-number rank-${rankClass}">${rank}</span>`;

    let medalIcon = "";
    if (isUniqueRank && rank === 1) medalIcon = "🔥";
    else if (isUniqueRank && rank === 2) medalIcon = "🥈";
    else if (isUniqueRank && rank === 3) medalIcon = "🥉";
    // Medal slot is always rendered (even when empty) so every row's
    // name/bar column keeps the exact same width regardless of whether
    // a medal icon is shown - this keeps the progress bars comparable.
    const medalHtml = `<span class="rank-medal">${medalIcon}</span>`;

    // Bar width is relative to the top score, with a small minimum so a
    // count of 0 is still visible as an (almost) empty bar rather than
    // looking identical to a bar with a real, larger, hidden minimum.
    const pct = maxCount > 0 ? Math.max(2, Math.round((u.activity_count / maxCount) * 100)) : 0;
    const unit = u.activity_count === 1 ? "workout" : "workouts";

    const row = document.createElement("div");
    row.className = `leaderboard-row${isMe ? " leaderboard-row-me" : ""}`;
    row.innerHTML = `
      ${badgeHtml}
      <img class="leaderboard-avatar" src="${getAvatarUrl(u)}" alt="${u.username}">
      <div class="leaderboard-main-col">
        <div class="leaderboard-name">${u.username}${isMe ? " (You)" : ""}</div>
        <div class="leaderboard-bar-outer"><div class="leaderboard-bar-inner" style="width:${pct}%"></div></div>
      </div>
      <div class="leaderboard-count">
        <div class="leaderboard-count-num">${u.activity_count}</div>
        <div class="leaderboard-count-unit">${unit}</div>
      </div>
      ${medalHtml}
    `;
    row.onclick = () => openUserDetail(u.id, u.username, u.avatar);
    list.appendChild(row);
  });
}

async function renderCarousel() {
  const res = await fetch(`${API}/users`, { headers: authHeaders() });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return;
  }
  const users = await res.json();
  const carousel = document.getElementById("carousel");
  carousel.innerHTML = "";
  users.forEach(u => {
    const item = document.createElement("div");
    item.className = "carousel-item";
    item.innerHTML = `<img src="${getAvatarUrl(u)}" alt="${u.username}"><span>${u.username}</span>`;
    item.onclick = () => openUserDetail(u.id, u.username, u.avatar);
    carousel.appendChild(item);
  });
}

document.getElementById("carousel-left").onclick = () =>
  document.getElementById("carousel").scrollBy({ left: -140, behavior: "smooth" });
document.getElementById("carousel-right").onclick = () =>
  document.getElementById("carousel").scrollBy({ left: 140, behavior: "smooth" });

let currentDetailUserId = null;
let currentDetailUsername = null;
let currentDetailAvatar = null;

async function openUserDetail(userId, username, avatar) {
  currentDetailUserId = userId;
  currentDetailUsername = username;
  currentDetailAvatar = avatar;

  const res = await fetch(`${API}/users/${userId}/activities`, { headers: authHeaders() });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return;
  }
  const acts = await res.json();
  const goal = 12;
  const isOwnProfile = !!(currentUser && Number(userId) === Number(currentUser.id));

  document.getElementById("detail-username").textContent = username;
  document.getElementById("detail-avatar").src = getAvatarUrl({ username, avatar });
  document.getElementById("detail-progress").textContent = `${acts.length} / ${goal} activities logged this month`;
  document.getElementById("detail-progress-fill").style.width = `${Math.min(100, (acts.length / goal) * 100)}%`;

  // Show/hide the "change avatar" control and "delete account" button
  // depending on whether this is the logged-in user's own profile.
  document.getElementById("change-avatar-btn").hidden = !isOwnProfile;
  document.getElementById("delete-account-btn").hidden = !isOwnProfile;

  const list = document.getElementById("detail-activity-list");
  list.innerHTML = "";
  if (acts.length === 0) {
    list.innerHTML = `<p class="empty-msg">No activities logged yet this month.</p>`;
  } else {
    acts.forEach(a => {
      const card = document.createElement("div");
      card.className = "activity-card";
      const dateStr = new Date(a.logged_at).toLocaleDateString();
      const deleteBtnHtml = isOwnProfile
        ? `<button class="activity-delete-btn" data-activity-id="${a.id}" aria-label="Delete activity" title="Delete activity">✕</button>`
        : "";
      const noteHtml = a.note
        ? `<div class="activity-note">${a.note}</div>`
        : "";
      card.innerHTML = `${deleteBtnHtml}<img src="${a.image_path}" alt="activity" class="activity-photo"><div class="activity-date">${dateStr}</div>${noteHtml}`;
      list.appendChild(card);

      // Clicking the photo opens a lightbox showing the enlarged image
      // and its note underneath, closing again on an outside click.
      card.querySelector(".activity-photo").addEventListener("click", e => {
        e.stopPropagation();
        openLightbox(a.image_path, a.note);
      });
    });

    if (isOwnProfile) {
      list.querySelectorAll(".activity-delete-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          deleteActivity(btn.dataset.activityId);
        });
      });
    }
  }
  showView("user-detail-view");
}

/* ---------- Lightbox: enlarge a clicked activity photo ---------- */
const lightbox = document.getElementById("photo-lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxNote = document.getElementById("lightbox-note");

function openLightbox(imageSrc, note) {
  lightboxImage.src = imageSrc;
  lightboxNote.textContent = note || "";
  lightboxNote.hidden = !note;
  lightbox.hidden = false;
}
function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.src = "";
}
// Close when clicking anywhere on the overlay outside the enlarged image/note.
lightbox.addEventListener("click", e => {
  if (e.target === lightbox) closeLightbox();
});

async function deleteActivity(activityId) {
  if (!confirm("Delete this activity? This cannot be undone.")) return;
  const res = await fetch(`${API}/activities/${activityId}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to delete activity");
    return;
  }
  // Refresh the detail view to reflect the deletion
  await openUserDetail(currentDetailUserId, currentDetailUsername, currentDetailAvatar);
}

document.getElementById("change-avatar-input").onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch(`${API}/users/me/avatar`, {
    method: "PUT",
    headers: authHeaders(),
    body: formData
  });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to update profile picture");
    return;
  }
  const updatedUser = await res.json();

  // Update local session copy of currentUser
  currentUser = { ...currentUser, avatar: updatedUser.avatar };
  localStorage.setItem("currentUser", JSON.stringify(currentUser));
  currentDetailAvatar = updatedUser.avatar;

  document.getElementById("detail-avatar").src = getAvatarUrl(updatedUser);
  e.target.value = "";
};

document.getElementById("delete-account-btn").onclick = async () => {
  if (!confirm("Delete your account? This will permanently remove your profile and all your logged activities. This cannot be undone.")) return;
  if (!confirm("Are you absolutely sure? This action is irreversible.")) return;

  const res = await fetch(`${API}/users/me`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (res.status === 401) {
    clearSession();
    showView("login-view");
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to delete account");
    return;
  }
  alert("Your account has been deleted.");
  clearSession();
  showView("login-view");
};

document.getElementById("back-to-dashboard").onclick = () => {
  showView("dashboard-view");
  renderLeaderboard(); renderCarousel();
};

const modal = document.getElementById("log-modal");
let pendingFile = null;

document.getElementById("log-activity-btn").onclick = () => {
  pendingFile = null;
  document.getElementById("capture-preview").hidden = true;
  document.getElementById("capture-note").value = "";
  document.getElementById("capture-submit").disabled = true;
  modal.hidden = false;
};
document.getElementById("capture-cancel").onclick = () => { modal.hidden = true; };
modal.addEventListener("click", e => {
  if (e.target === modal) modal.hidden = true;
});

function handleFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById("capture-preview");
    preview.src = ev.target.result; preview.hidden = false;
    document.getElementById("capture-submit").disabled = false;
  };
  reader.readAsDataURL(file);
}
document.getElementById("capture-camera").onchange = handleFileInput;
document.getElementById("capture-gallery").onchange = handleFileInput;

document.getElementById("capture-submit").onclick = async () => {
  if (!pendingFile) return;
  const formData = new FormData();
  formData.append("photo", pendingFile);
  formData.append("note", document.getElementById("capture-note").value.trim());

  const res = await fetch(`${API}/activities`, {
    method: "POST", headers: authHeaders(), body: formData
  });
  if (res.status === 401) {
    clearSession();
    modal.hidden = true;
    showView("login-view");
    return;
  }
  if (!res.ok) { alert("Failed to log activity"); return; }
  modal.hidden = true;
  await renderLeaderboard();
};

/* ---------- Session refresh: keep the 12h token alive across page reloads ---------- */
async function refreshSession() {
  try {
    const res = await fetch(`${API}/refresh`, { method: "POST", headers: authHeaders() });
    if (!res.ok) {
      clearSession();
      showView("login-view");
      return false;
    }
    const data = await res.json();
    token = data.token; currentUser = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    return true;
  } catch {
    // Network error: keep existing session, let subsequent API calls handle 401s
    return true;
  }
}

/* ---------- Init: always start on login unless a valid session exists ---------- */
showView("login-view");
if (token && currentUser) {
  refreshSession().then(ok => {
    if (ok) enterDashboard();
  });
}
