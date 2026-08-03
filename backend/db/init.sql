CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  note TEXT,
  logged_at TIMESTAMP DEFAULT NOW()
);

-- Register users through the app UI to create accounts with properly
-- hashed passwords. No demo users are seeded by default.
