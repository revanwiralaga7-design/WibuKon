// Migrasi skema + seed awal. Idempoten (CREATE TABLE IF NOT EXISTS),
// aman dijalankan setiap cold start serverless.
const db = require('./db')
const defaults = require('./defaults')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    google_id TEXT,
    email TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    vip BOOLEAN NOT NULL DEFAULT FALSE,
    vip_until TIMESTAMPTZ,
    xp INTEGER NOT NULL DEFAULT 0,
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);
`

// Untuk DB yang dibuat sebelum ada kolom Google/role — ALTER ini dijalankan
// best-effort (error diabaikan, karena DB baru sudah punya kolomnya dari CREATE di atas).
const ALTERS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS vip BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_until TIMESTAMPTZ"
]

const SCHEMA_REST = `
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anime_id TEXT NOT NULL,
    eps_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(anime_id, eps_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, id DESC);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS xp_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    amount INTEGER NOT NULL,
    label TEXT,
    uniq TEXT,
    day TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_user_day ON xp_events(user_id, day);
CREATE INDEX IF NOT EXISTS idx_xp_day ON xp_events(day);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS watched_episodes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anime_id TEXT NOT NULL,
    eps_id TEXT NOT NULL,
    watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, anime_id, eps_id)
);
CREATE INDEX IF NOT EXISTS idx_watched_user ON watched_episodes(user_id, watched_at DESC);
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_id ON chat_messages(id DESC);
CREATE TABLE IF NOT EXISTS vip_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    via TEXT NOT NULL,
    proof TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    processed_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vipreq_status ON vip_requests(status, id DESC);
`

async function seed() {
    // Catatan: akun OWNER tidak lagi dibuat di tabel terpisah.
    // Owner pertama dibuat OTOMATIS dari env OWNER_USERNAME/OWNER_EMAIL saat
    // user tsb register/login (lihat authUtil.maybeBootstrapOwner).

    // Seed settings default (lewati yang sudah ada)
    const def = defaults.defaultSettings()
    for (const key of Object.keys(def)) {
        const { rows: r } = await db.q('SELECT 1 FROM settings WHERE key = $1', [key])
        if (!r.length) {
            await db.q('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, JSON.stringify(def[key])])
        }
    }
}

async function run() {
    if (!db.enabled()) return false
    await db.q(SCHEMA + SCHEMA_REST)
    for (const sql of ALTERS) {
        try { await db.q(sql) } catch (e) { /* kolom sudah ada / tidak didukung emulasi */ }
    }
    await seed()
    return true
}

// Promise memoized: migrasi hanya jalan SEKALI per proses
let ready = null
function ensureMigrated() {
    if (!db.enabled()) return Promise.resolve(false)
    if (!ready) ready = run()
    return ready
}

module.exports = { ensureMigrated }
