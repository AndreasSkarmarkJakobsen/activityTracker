const API = "/api";
let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let chartInstance = null;

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function authHeaders() { return { Authorization: `Bearer ${token}` }; }

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
  token = null; currentUser = null;
  localStorage.removeItem("token"); localStorage.removeItem("currentUser");
  showView("login-view");
};

async function enterDashboard() {
  document.getElementById("welcome-msg").textContent = `Hi, ${currentUser.username}!`;
  showView("dashboard-view");
  await renderChart();
  await renderCarousel();
}

async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`, { headers: authHeaders() });
  if (res.status === 401) { showView("login-view"); return []; }
  return res.json();
}

async function renderChart() {
  const data = await fetchLeaderboard();
  const ctx = document.getElementById("leaderboard-chart").getContext("2d");
  const counts = data.map(u => Number(u.activity_count));
  const maxCount = Math.max(...counts, 0);
  const maxIndex = counts.indexOf(maxCount);

  if (chartInstance) chartInstance.destroy();

  const avatarPlugin = {
    id: "avatarPlugin",
    afterDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      data.forEach((u, i) => {
        const img = new Image();
        img.src = u.avatar || "/uploads/default-avatar.png";
        const xPos = x.getPixelForTick(i);
        const size = 36;
        ctx.save();
        ctx.beginPath();
        ctx.arc(xPos, x.bottom + 26, size / 2, 0, Math.PI * 2);
        ctx.closePath(); ctx.clip();
        ctx.drawImage(img, xPos - size/2, x.bottom + 8, size, size);
        ctx.restore();

        if (i === maxIndex && maxCount > 0) {
          const barTop = y.getPixelForValue(counts[i]);
          ctx.font = "bold 14px sans-serif";
          ctx.fillStyle = "#f59e0b";
          ctx.textAlign = "center";
          ctx.fillText(`👑 ${counts[i]}`, xPos, barTop - 12);
        }
      });
    }
  };

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(u => u.username),
      datasets: [{
        label: "Activities this month",
        data: counts,
        backgroundColor: data.map((_, i) => i === maxIndex && maxCount > 0 ? "#f59e0b" : "#4f46e5"),
        borderRadius: 6,
        maxBarThickness: 50
      }]
    },
    options: {
      responsive: true,
      layout: { padding: { bottom: 40, top: 30 } },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { ticks: { display: false } }
      }
    },
    plugins: [avatarPlugin]
  });
}

async function renderCarousel() {
  const res = await fetch(`${API}/users`, { headers: authHeaders() });
  const users = await res.json();
  const carousel = document.getElementById("carousel");
  carousel.innerHTML = "";
  users.forEach(u => {
    const item = document.createElement("div");
    item.className = "carousel-item";
    item.innerHTML = `<img src="${u.avatar || '/uploads/default-avatar.png'}" alt="${u.username}"><span>${u.username}</span>`;
    item.onclick = () => openUserDetail(u.id, u.username, u.avatar);
    carousel.appendChild(item);
  });
}

document.getElementById("carousel-left").onclick = () =>
  document.getElementById("carousel").scrollBy({ left: -160, behavior: "smooth" });
document.getElementById("carousel-right").onclick = () =>
  document.getElementById("carousel").scrollBy({ left: 160, behavior: "smooth" });

async function openUserDetail(userId, username, avatar) {
  const res = await fetch(`${API}/users/${userId}/activities`, { headers: authHeaders() });
  const acts = await res.json();
  const goal = 12;

  document.getElementById("detail-username").textContent = username;
  document.getElementById("detail-avatar").src = avatar || "/uploads/default-avatar.png";
  document.getElementById("detail-progress").textContent = `${acts.length} / ${goal} activities logged this month`;
  document.getElementById("detail-progress-fill").style.width = `${Math.min(100, (acts.length / goal) * 100)}%`;

  const list = document.getElementById("detail-activity-list");
  list.innerHTML = "";
  if (acts.length === 0) {
    list.innerHTML = `<p style="grid-column:1/-1;color:#888;">No activities logged yet this month.</p>`;
  } else {
    acts.forEach(a => {
      const card = document.createElement("div");
      card.className = "activity-card";
      const dateStr = new Date(a.logged_at).toLocaleDateString();
      card.innerHTML = `<img src="${a.image_path}" alt="activity"><div>${dateStr}</div>`;
      list.appendChild(card);
    });
  }
  showView("user-detail-view");
}
document.getElementById("back-to-dashboard").onclick = () => {
  showView("dashboard-view");
  renderChart(); renderCarousel();
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
  if (!res.ok) { alert("Failed to log activity"); return; }
  modal.hidden = true;
  await renderChart();
};

if (token && currentUser) enterDashboard();
else showView("login-view");
