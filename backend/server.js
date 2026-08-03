const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static("/app/uploads"));
app.use(express.static(path.join(__dirname, "public")));

// --- Multer setup for avatar + activity photo uploads ---
const uploadDir = "/app/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// Helper: delete an uploaded file from disk given its /uploads/<filename> path
function deleteUploadedFile(imagePath) {
  if (!imagePath || !imagePath.startsWith("/uploads/")) return;
  const filePath = path.join(uploadDir, path.basename(imagePath));
  fs.unlink(filePath, err => {
    if (err && err.code !== "ENOENT") console.error("Failed to delete file:", filePath, err);
  });
}

// --- Auth middleware ---
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// --- Auth routes ---
app.post("/api/register", upload.single("avatar"), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
    if (existing.rows.length) return res.status(409).json({ error: "Username already taken" });

    const hash = await bcrypt.hash(password, 10);
    const avatarPath = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      "INSERT INTO users (username, password_hash, avatar) VALUES ($1,$2,$3) RETURNING id, username, avatar",
      [username, hash, avatarPath]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Users list ---
app.get("/api/users", authRequired, async (req, res) => {
  const result = await pool.query("SELECT id, username, avatar FROM users ORDER BY username");
  res.json(result.rows);
});

// --- Leaderboard: activity counts for current month ---
app.get("/api/leaderboard", authRequired, async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.username, u.avatar,
      COUNT(a.id) FILTER (
        WHERE date_trunc('month', a.logged_at) = date_trunc('month', now())
      ) AS activity_count
    FROM users u
    LEFT JOIN activities a ON a.user_id = u.id
    GROUP BY u.id
    ORDER BY u.username
  `);
  res.json(result.rows);
});

// --- Activities for a specific user (this month) ---
app.get("/api/users/:id/activities", authRequired, async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(`
    SELECT id, user_id, image_path, note, logged_at
    FROM activities
    WHERE user_id = $1
      AND date_trunc('month', logged_at) = date_trunc('month', now())
    ORDER BY logged_at DESC
  `, [id]);
  res.json(result.rows);
});

// --- Log a new activity (photo upload) ---
app.post("/api/activities", authRequired, upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Photo is required" });
  const imagePath = `/uploads/${req.file.filename}`;
  const note = req.body.note || null;

  const result = await pool.query(
    "INSERT INTO activities (user_id, image_path, note) VALUES ($1,$2,$3) RETURNING *",
    [req.user.id, imagePath, note]
  );
  res.json(result.rows[0]);
});

// --- Delete an activity (only the owning user can delete their own) ---
app.delete("/api/activities/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
  const activity = result.rows[0];
  if (!activity) return res.status(404).json({ error: "Activity not found" });
  if (activity.user_id !== req.user.id) return res.status(403).json({ error: "You can only delete your own activities" });

  await pool.query("DELETE FROM activities WHERE id = $1", [id]);
  deleteUploadedFile(activity.image_path);
  res.json({ success: true });
});

// --- Update the logged-in user's own profile picture ---
app.put("/api/users/me/avatar", authRequired, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Avatar photo is required" });
  const newAvatarPath = `/uploads/${req.file.filename}`;

  const existing = await pool.query("SELECT avatar FROM users WHERE id = $1", [req.user.id]);
  const oldAvatar = existing.rows[0] ? existing.rows[0].avatar : null;

  const result = await pool.query(
    "UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, username, avatar",
    [newAvatarPath, req.user.id]
  );

  if (oldAvatar) deleteUploadedFile(oldAvatar);

  res.json(result.rows[0]);
});

// Fallback to SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
