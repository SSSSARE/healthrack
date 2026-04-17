// ============================================================
//  HealthTrack Backend  —  server.js
//  Stack: Node.js + Express + SQLite (better-sqlite3) + JWT
// ============================================================

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'healthtrack-secret-key-please-set-env';
if (!process.env.JWT_SECRET) console.warn('⚠️  Установите переменную JWT_SECRET в настройках Railway!');

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));   // serve index.html

// ── Database Setup ──────────────────────────────────────────
const db = new Database(path.join(__dirname, 'healthtrack.db'));

// Enable WAL for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    UNIQUE NOT NULL,
    email     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    name      TEXT,
    height    REAL,
    created_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS weights (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    weight     REAL    NOT NULL,
    height     REAL,
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    meal       TEXT    NOT NULL,
    kcal       REAL    DEFAULT 0,
    protein    REAL    DEFAULT 0,
    fat        REAL    DEFAULT 0,
    carbs      REAL    DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS blood_pressure (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    datetime   TEXT    NOT NULL,
    sys        INTEGER NOT NULL,
    dia        INTEGER NOT NULL,
    pulse      INTEGER,
    arm        TEXT,
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    duration   INTEGER NOT NULL,
    kcal       INTEGER,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id    INTEGER PRIMARY KEY,
    food_goal  INTEGER DEFAULT 2000,
    steps_goal INTEGER DEFAULT 10000,
    steps      INTEGER DEFAULT 0,
    water      INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── Auth Middleware ─────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ error: 'Токен не предоставлен' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
}

// ── AUTH ROUTES ─────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password, name } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, email, password, name) VALUES (?, ?, ?, ?)'
    ).run(username, email, hash, name || username);

    // Create default settings
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(result.lastInsertRowid);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, username, email, name: name || username } });
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'Пользователь с таким именем или email уже существует' });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password)
    return res.status(400).json({ error: 'Введите логин и пароль' });

  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).get(login, login);

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Неверный логин или пароль' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, name: user.name, height: user.height }
  });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, email, name, height FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
});

// PUT /api/auth/profile
app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, height } = req.body;
  db.prepare('UPDATE users SET name = ?, height = ? WHERE id = ?').run(name, height, req.userId);
  res.json({ success: true });
});

// ── DATA: GET ALL (for initial load) ───────────────────────

// GET /api/data  — returns all user data in one request
app.get('/api/data', authMiddleware, (req, res) => {
  const weights    = db.prepare('SELECT * FROM weights WHERE user_id = ? ORDER BY date ASC').all(req.userId);
  const foods      = db.prepare('SELECT * FROM foods WHERE user_id = ? ORDER BY date ASC, id ASC').all(req.userId);
  const bp         = db.prepare('SELECT * FROM blood_pressure WHERE user_id = ? ORDER BY datetime ASC').all(req.userId);
  const activities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY date ASC, id ASC').all(req.userId);
  const settings   = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId) || {};
  const user       = db.prepare('SELECT id, username, email, name, height FROM users WHERE id = ?').get(req.userId);

  res.json({ weights, foods, bp, activities, settings, user });
});

// ── WEIGHT ROUTES ───────────────────────────────────────────

// POST /api/weights
app.post('/api/weights', authMiddleware, (req, res) => {
  const { date, weight, height, note } = req.body;
  if (!date || !weight) return res.status(400).json({ error: 'Дата и вес обязательны' });
  const r = db.prepare(
    'INSERT INTO weights (user_id, date, weight, height, note) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, date, weight, height || null, note || null);
  res.json({ id: r.lastInsertRowid, date, weight, height, note });
});

// DELETE /api/weights/:id
app.delete('/api/weights/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM weights WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ── FOOD ROUTES ─────────────────────────────────────────────

// POST /api/foods
app.post('/api/foods', authMiddleware, (req, res) => {
  const { date, name, meal, kcal, protein, fat, carbs } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'Дата и название обязательны' });
  const r = db.prepare(
    'INSERT INTO foods (user_id, date, name, meal, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, date, name, meal || 'Завтрак', kcal || 0, protein || 0, fat || 0, carbs || 0);
  res.json({ id: r.lastInsertRowid, date, name, meal, kcal, protein, fat, carbs });
});

// DELETE /api/foods/:id
app.delete('/api/foods/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ── BLOOD PRESSURE ROUTES ───────────────────────────────────

// POST /api/bp
app.post('/api/bp', authMiddleware, (req, res) => {
  const { datetime, sys, dia, pulse, arm, note } = req.body;
  if (!datetime || !sys || !dia) return res.status(400).json({ error: 'Дата, систолическое и диастолическое давление обязательны' });
  const r = db.prepare(
    'INSERT INTO blood_pressure (user_id, datetime, sys, dia, pulse, arm, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, datetime, sys, dia, pulse || null, arm || null, note || null);
  res.json({ id: r.lastInsertRowid, datetime, sys, dia, pulse, arm, note });
});

// DELETE /api/bp/:id
app.delete('/api/bp/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM blood_pressure WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ── ACTIVITY ROUTES ─────────────────────────────────────────

// POST /api/activities
app.post('/api/activities', authMiddleware, (req, res) => {
  const { date, type, duration, kcal } = req.body;
  if (!date || !type || !duration) return res.status(400).json({ error: 'Дата, тип и длительность обязательны' });
  const r = db.prepare(
    'INSERT INTO activities (user_id, date, type, duration, kcal) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, date, type, duration, kcal || null);
  res.json({ id: r.lastInsertRowid, date, type, duration, kcal });
});

// DELETE /api/activities/:id
app.delete('/api/activities/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ── SETTINGS ROUTE ──────────────────────────────────────────

// PUT /api/settings
app.put('/api/settings', authMiddleware, (req, res) => {
  const { food_goal, steps_goal, steps, water } = req.body;
  db.prepare(`
    INSERT INTO settings (user_id, food_goal, steps_goal, steps, water)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      food_goal  = excluded.food_goal,
      steps_goal = excluded.steps_goal,
      steps      = excluded.steps,
      water      = excluded.water
  `).run(req.userId, food_goal || 2000, steps_goal || 10000, steps || 0, water || 0);
  res.json({ success: true });
});

// ── Catch-all: serve frontend ───────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  HealthTrack сервер запущен: http://localhost:${PORT}`);
  console.log(`📦  База данных: healthtrack.db`);
  console.log(`🔐  JWT: Bearer token (7 дней)\n`);
});
