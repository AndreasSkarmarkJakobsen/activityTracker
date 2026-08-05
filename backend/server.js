const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const exifr = require("exifr");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES_IN = "12h";

// Generate a random admin token once at startup — rotates on every restart
const ADMIN_TOKEN = crypto.randomBytes(32).toString("hex");
console.log("ADMIN TOKEN:", ADMIN_TOKEN);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Run safe migrations to add new columns if they don't exist yet
pool.query(`
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS exercise_type TEXT NOT NULL DEFAULT '';
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS exif_taken_at TIMESTAMP NULL;
`).catch(err => console.error("Migration error:", err));

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
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// Helper: delete an uploaded file from disk given its /uploads/<filename> path
function deleteUploadedFile(imagePath) {
  if (!imagePath || !imagePath.startsWith("/uploads/")) return;
  const filePath = path.join(uploadDir, path.basename(imagePath));
  fs.unlink(filePath, err => {
    if (err && err.code !== "ENOENT") console.error("Failed to delete file:", filePath, err);
  });
}

// Helper: compress image file in-place if it exceeds 5MB.
// Returns the (possibly updated) file path.
const COMPRESS_THRESHOLD = 5 * 1024 * 1024;
async function compressIfNeeded(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= COMPRESS_THRESHOLD) return filePath;
    const tmpPath = filePath + ".tmp.jpg";
    await sharp(filePath)
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error("Image compression failed, keeping original:", err);
  }
  return filePath;
}

// --- Admin token middleware ---
function adminRequired(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Helper: delete a user and all their data from DB + disk
async function deleteUserById(userId) {
  const userResult = await pool.query("SELECT avatar FROM users WHERE id = $1", [userId]);
  const user = userResult.rows[0];
  if (!user) return false;
  const activitiesResult = await pool.query("SELECT image_path FROM activities WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  activitiesResult.rows.forEach(a => deleteUploadedFile(a.image_path));
  if (user.avatar) deleteUploadedFile(user.avatar);
  return true;
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
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Refresh: exchange a still-valid token for a new one with a renewed 12h expiry ---
app.post("/api/refresh", authRequired, async (req, res) => {
  const result = await pool.query("SELECT id, username, avatar FROM users WHERE id = $1", [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({ token, user });
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
    SELECT id, user_id, image_path, note, exercise_type, exif_taken_at, logged_at
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
  const exerciseType = (req.body.exercise_type || "").trim();
  if (!exerciseType) return res.status(400).json({ error: "Exercise type is required" });

  const note = req.body.note || null;

  // Best-effort EXIF timestamp extraction (from original file, before compression)
  let exifTakenAt = null;
  try {
    const exifData = await exifr.parse(req.file.path, ["DateTimeOriginal", "CreateDate"]);
    if (exifData) {
      exifTakenAt = exifData.DateTimeOriginal || exifData.CreateDate || null;
    }
  } catch (e) {
    // No EXIF data or parse error — continue without it
  }

  // Compress large images (>5MB) in-place
  await compressIfNeeded(req.file.path);

  const imagePath = `/uploads/${req.file.filename}`;
  const result = await pool.query(
    "INSERT INTO activities (user_id, image_path, note, exercise_type, exif_taken_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [req.user.id, imagePath, note, exerciseType, exifTakenAt]
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

  // Compress large avatars (>5MB) in-place
  await compressIfNeeded(req.file.path);

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

// --- Delete the logged-in user's own account (and all their activities + uploaded files) ---
app.delete("/api/users/me", authRequired, async (req, res) => {
  const deleted = await deleteUserById(req.user.id);
  if (!deleted) return res.status(404).json({ error: "User not found" });
  res.json({ success: true });
});

// --- Admin API routes (protected by admin token) ---
app.get("/api/admin/users", adminRequired, async (req, res) => {
  const result = await pool.query("SELECT id, username, avatar, created_at FROM users ORDER BY username");
  res.json(result.rows);
});

app.put("/api/admin/users/:id/password", adminRequired, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password is required" });
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username", [hash, id]);
  if (!result.rows.length) return res.status(404).json({ error: "User not found" });
  res.json({ success: true, user: result.rows[0] });
});

app.delete("/api/admin/users/:id", adminRequired, async (req, res) => {
  const { id } = req.params;
  const deleted = await deleteUserById(parseInt(id, 10));
  if (!deleted) return res.status(404).json({ error: "User not found" });
  res.json({ success: true });
});

// Multer error handler — must be 4-argument Express error middleware
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Please use an image under 25MB." });
  }
  if (err && err.name === "MulterError") {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  next(err);
});

// Fallback to SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Admin UI server on a separate port ---
const adminApp = express();
adminApp.use(cors());
adminApp.use(express.json());
adminApp.use(express.static(path.join(__dirname, "admin-public")));
adminApp.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-public", "admin.html"));
});
adminApp.listen(ADMIN_PORT, () => console.log(`Admin UI running on port ${ADMIN_PORT}`));
