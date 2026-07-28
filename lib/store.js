// Semua akses data ke PostgreSQL (dipakai route & service)
const db = require('./db')
const defaults = require('./defaults')

const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_TTL_MS = 7 * DAY_MS
const todayUtc = () => new Date().toISOString().slice(0, 10)

/* ==================== USERS ==================== */

async function createUser(username, passwordHash) {
    const { rows } = await db.q(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, xp, is_banned, created_at',
        [username, passwordHash]
    )
    return rows[0]
}

// User dari login Google: tanpa password (password_hash kosong)
async function createGoogleUser({ username, googleId, email, avatarUrl }) {
    const { rows } = await db.q(
        'INSERT INTO users (username, password_hash, google_id, email, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [username, '', googleId, email || null, avatarUrl || null]
    )
    return rows[0]
}

async function findUserByGoogleId(googleId) {
    const { rows } = await db.q('SELECT * FROM users WHERE google_id = $1', [googleId])
    return rows[0] || null
}

// Login Google berikutnya bisa memperbarui avatar yang basi
async function updateGoogleProfile(userId, avatarUrl) {
    await db.q('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId])
}

async function findUserByName(username) {
    const { rows } = await db.q('SELECT * FROM users WHERE username = $1', [String(username).toLowerCase()])
    return rows[0] || null
}

async function findUserById(id) {
    const { rows } = await db.q('SELECT * FROM users WHERE id = $1', [id])
    return rows[0] || null
}

function escapeLike(s) {
    return String(s).replace(/[%_\\]/g, '')
}

async function listUsers(search, limit, offset) {
    const pattern = '%' + escapeLike(search || '').toLowerCase() + '%'
    const { rows } = await db.q(
        'SELECT id, username, xp, is_banned, created_at, last_seen_at FROM users WHERE username ILIKE $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
        [pattern, limit, offset]
    )
    return rows
}

async function countUsers(search) {
    if (search) {
        const { rows } = await db.q('SELECT COUNT(*)::int AS c FROM users WHERE username ILIKE $1', ['%' + escapeLike(search).toLowerCase() + '%'])
        return rows[0].c
    }
    const { rows } = await db.q('SELECT COUNT(*)::int AS c FROM users')
    return rows[0].c
}

// delta boleh negatif; xp tidak pernah < 0. Return xp terbaru.
async function addXp(userId, delta) {
    const { rows } = await db.q(
        'UPDATE users SET xp = GREATEST(0, xp + $1) WHERE id = $2 RETURNING xp',
        [delta, userId]
    )
    return rows[0] ? rows[0].xp : null
}

async function setBanned(userId, banned) {
    await db.q('UPDATE users SET is_banned = $1 WHERE id = $2', [banned, userId])
    if (banned) await db.q("DELETE FROM sessions WHERE kind = 'user' AND ref_id = $1", [userId])
}

async function touchUser(userId) {
    await db.q('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId])
}

async function setUserRole(userId, role) {
    await db.q('UPDATE users SET role = $1 WHERE id = $2', [role, userId])
}

/* ==================== KOMENTAR ==================== */

async function addComment(userId, animeId, epsId, body) {
    const { rows } = await db.q(
        'INSERT INTO comments (user_id, anime_id, eps_id, body) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
        [userId, animeId, epsId, body]
    )
    return rows[0]
}

async function listComments(animeId, epsId, limit) {
    const { rows } = await db.q(
        `SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.avatar_url, u.role
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.anime_id = $1 AND c.eps_id = $2
         ORDER BY c.id DESC LIMIT $3`,
        [animeId, epsId, limit || 50]
    )
    return rows
}

async function countComments(animeId, epsId) {
    const { rows } = await db.q('SELECT COUNT(*)::int AS c FROM comments WHERE anime_id = $1 AND eps_id = $2', [animeId, epsId])
    return rows[0].c
}

async function findComment(id) {
    const { rows } = await db.q('SELECT * FROM comments WHERE id = $1', [id])
    return rows[0] || null
}

async function deleteComment(id) {
    await db.q('DELETE FROM comments WHERE id = $1', [id])
}

async function lastCommentAt(userId) {
    const { rows } = await db.q('SELECT created_at FROM comments WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId])
    return rows[0] ? rows[0].created_at : null
}

/* ==================== EPISODE DITONTON ==================== */

// Idempoten: nonton ulang episode yang sama tidak menambah baris baru
async function markWatchedDb(userId, animeId, epsId) {
    await db.q(
        'INSERT INTO watched_episodes (user_id, anime_id, eps_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, animeId, epsId]
    )
}

async function watchedForAnime(userId, animeId) {
    const { rows } = await db.q(
        'SELECT eps_id FROM watched_episodes WHERE user_id = $1 AND anime_id = $2',
        [userId, animeId]
    )
    return rows.map(r => r.eps_id)
}

/* ==================== LEADERBOARD ==================== */

async function topAllTime(limit) {
    const { rows } = await db.q(
        'SELECT id, username, avatar_url, role, xp AS amount FROM users WHERE is_banned = false ORDER BY xp DESC, id ASC LIMIT $1',
        [limit]
    )
    return rows
}

// Peringkat berdasarkan total EXP event sejak tanggal tertentu (UTC).
// Penyesuaian admin (admin_adjust) & nilai negatif tidak dihitung biar adil.
async function topSince(day, limit) {
    const { rows } = await db.q(
        `SELECT u.id, u.username, u.avatar_url, u.role, SUM(e.amount)::int AS amount
         FROM xp_events e JOIN users u ON u.id = e.user_id
         WHERE e.day >= $1 AND e.amount > 0 AND e.event_key <> 'admin_adjust' AND u.is_banned = false
         GROUP BY u.id, u.username, u.avatar_url, u.role
         ORDER BY amount DESC, u.id ASC LIMIT $2`,
        [day, limit]
    )
    return rows
}

async function myRankAll(xp) {
    const { rows } = await db.q('SELECT COUNT(*)::int + 1 AS r FROM users WHERE is_banned = false AND xp > $1', [xp])
    return rows[0].r
}

async function mySumSince(userId, day) {
    const { rows } = await db.q(
        "SELECT COALESCE(SUM(amount), 0)::int AS s FROM xp_events WHERE user_id = $1 AND day >= $2 AND amount > 0 AND event_key <> 'admin_adjust'",
        [userId, day]
    )
    return rows[0].s
}

async function myRankSince(day, mySum) {
    const { rows } = await db.q(
        `SELECT COUNT(*)::int + 1 AS r FROM (
            SELECT e.user_id, SUM(e.amount) AS s
            FROM xp_events e JOIN users u ON u.id = e.user_id
            WHERE e.day >= $1 AND e.amount > 0 AND e.event_key <> 'admin_adjust' AND u.is_banned = false
            GROUP BY e.user_id
        ) t WHERE t.s > $2`,
        [day, mySum]
    )
    return rows[0].r
}

/* ==================== ADMINS ==================== */

async function createAdmin(username, passwordHash, role) {
    const { rows } = await db.q(
        'INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
        [String(username).toLowerCase(), passwordHash, role]
    )
    return rows[0]
}

async function findAdminByName(username) {
    const { rows } = await db.q('SELECT * FROM admins WHERE username = $1', [String(username).toLowerCase()])
    return rows[0] || null
}

async function findAdminById(id) {
    const { rows } = await db.q('SELECT id, username, role, created_at FROM admins WHERE id = $1', [id])
    return rows[0] || null
}

async function listAdmins() {
    const { rows } = await db.q('SELECT id, username, role, created_at FROM admins ORDER BY id')
    return rows
}

async function deleteAdmin(id) {
    await db.q('DELETE FROM admins WHERE id = $1', [id])
    await db.q("DELETE FROM sessions WHERE kind = 'admin' AND ref_id = $1", [id])
}

/* ==================== SESSIONS ==================== */

async function createSession(kind, refId) {
    const { randomToken } = require('./cryptoUtil')
    const token = randomToken()
    const expires = new Date(Date.now() + SESSION_TTL_MS)
    await db.q(
        'INSERT INTO sessions (token, kind, ref_id, expires_at) VALUES ($1, $2, $3, $4)',
        [token, kind, refId, expires]
    )
    return { token, expires }
}

async function findSession(token, kind) {
    const { rows } = await db.q('SELECT * FROM sessions WHERE token = $1 AND kind = $2', [token, kind])
    const s = rows[0]
    if (!s) return null
    if (new Date(s.expires_at).getTime() < Date.now()) {
        await deleteSession(s.token)
        return null
    }
    return s
}

async function deleteSession(token) {
    await db.q('DELETE FROM sessions WHERE token = $1', [token])
}

/* ==================== XP EVENTS ==================== */

async function addXpEvent(userId, eventKey, amount, label, uniq, day) {
    await db.q(
        'INSERT INTO xp_events (user_id, event_key, amount, label, uniq, day) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, eventKey, amount, label, uniq || null, day || todayUtc()]
    )
}

async function countEventToday(userId, eventKey) {
    const { rows } = await db.q(
        'SELECT COUNT(*)::int AS c FROM xp_events WHERE user_id = $1 AND event_key = $2 AND day = $3',
        [userId, eventKey, todayUtc()]
    )
    return rows[0].c
}

async function existsUniqToday(userId, eventKey, uniq) {
    const { rows } = await db.q(
        'SELECT 1 FROM xp_events WHERE user_id = $1 AND event_key = $2 AND uniq = $3 AND day = $4 LIMIT 1',
        [userId, eventKey, uniq, todayUtc()]
    )
    return rows.length > 0
}

async function recentXpEvents(userId, limit) {
    const { rows } = await db.q(
        'SELECT event_key, amount, label, day, created_at FROM xp_events WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
        [userId, limit || 20]
    )
    return rows
}

async function dailyActiveUsers() {
    const { rows } = await db.q('SELECT COUNT(DISTINCT user_id)::int AS c FROM xp_events WHERE day = $1', [todayUtc()])
    return rows[0].c
}

/* ==================== STATISTIK DASHBOARD ==================== */

async function stats() {
    const [total, sum, dau, baru, bans] = await Promise.all([
        db.q('SELECT COUNT(*)::int AS c FROM users'),
        db.q('SELECT COALESCE(SUM(xp), 0)::bigint AS s, COALESCE(AVG(xp), 0)::float AS a FROM users'),
        dailyActiveUsers(),
        db.q('SELECT COUNT(*)::int AS c FROM users WHERE created_at >= $1', [todayUtc() + 'T00:00:00Z']),
        db.q('SELECT COUNT(*)::int AS c FROM users WHERE is_banned')
    ])
    return {
        totalUsers: total.rows[0].c,
        totalXp: Number(sum.rows[0].s),
        avgXp: Math.round(sum.rows[0].a),
        activeToday: dau,
        newToday: baru.rows[0].c,
        banned: bans.rows[0].c
    }
}

async function allUserXp() {
    const { rows } = await db.q('SELECT xp FROM users')
    return rows.map(r => r.xp)
}

async function newestUsers(limit) {
    const { rows } = await db.q(
        'SELECT id, username, xp, created_at FROM users ORDER BY id DESC LIMIT $1',
        [limit]
    )
    return rows
}

/* ==================== SETTINGS ==================== */

async function getSettings() {
    const def = defaults.defaultSettings()
    try {
        const { rows } = await db.q('SELECT key, value FROM settings')
        const out = { ...def }
        for (const r of rows) {
            try {
                out[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value
            } catch (e) { /* abaikan baris korup */ }
        }
        return out
    } catch (e) {
        return def
    }
}

async function setSetting(key, value) {
    await db.q('UPDATE settings SET value = $2, updated_at = now() WHERE key = $1', [key, JSON.stringify(value)])
}

module.exports = {
    createUser, createGoogleUser, findUserByGoogleId, updateGoogleProfile,
    findUserByName, findUserById, listUsers, countUsers,
    addXp, setBanned, setUserRole, touchUser,
    addComment, listComments, countComments, findComment, deleteComment, lastCommentAt,
    markWatchedDb, watchedForAnime,
    topAllTime, topSince, myRankAll, mySumSince, myRankSince,
    createAdmin, findAdminByName, findAdminById, listAdmins, deleteAdmin,
    createSession, findSession, deleteSession,
    addXpEvent, countEventToday, existsUniqToday, recentXpEvents,
    dailyActiveUsers, stats, allUserXp, newestUsers,
    getSettings, setSetting, todayUtc
}
