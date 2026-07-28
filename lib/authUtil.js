// Helper session cookie + middleware auth (user & admin)
const db = require('./db')
const store = require('./store')

const USER_COOKIE = 'wb_session'
const ADMIN_COOKIE = 'wb_admin'
const SEVEN_DAYS = 7 * 24 * 60 * 60

function parseCookies(req) {
    const out = {}
    const raw = req.headers.cookie
    if (!raw) return out
    for (const part of raw.split(';')) {
        const i = part.indexOf('=')
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
    return out
}

function cookieLine(name, value, maxAgeSec, req) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
    return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`
}

function setSessionCookie(res, req, name, token) {
    res.append('Set-Cookie', cookieLine(name, token, SEVEN_DAYS, req))
}

function clearCookie(res, req, name) {
    res.append('Set-Cookie', cookieLine(name, '', 0, req))
}

// Rate limit login sederhana per IP (in-memory, cukup untuk v1)
const attempts = new Map()
function loginRateOk(ip) {
    const now = Date.now()
    const a = attempts.get(ip) || { fails: 0, until: 0 }
    if (a.until > now) return false
    return true
}
function loginFailed(ip) {
    const now = Date.now()
    const a = attempts.get(ip) || { fails: 0, until: 0 }
    a.fails += 1
    if (a.fails >= 8) { a.until = now + 10 * 60 * 1000; a.fails = 0 }
    attempts.set(ip, a)
}
function loginSucceeded(ip) {
    attempts.delete(ip)
}

// Pasang req.authUser & res.locals.authUser jika session user valid
async function attachUser(req, res, next) {
    res.locals.authUser = null
    req.authUser = null
    if (!db.enabled()) return next()
    try {
        const token = parseCookies(req)[USER_COOKIE]
        if (!token) return next()
        const s = await store.findSession(token, 'user')
        if (!s) return next()
        const user = await store.findUserById(s.ref_id)
        if (!user || user.is_banned) {
            await store.deleteSession(token)
            clearCookie(res, req, USER_COOKIE)
            return next()
        }
        req.authUser = user
        res.locals.authUser = { id: user.id, username: user.username, xp: user.xp, avatar_url: user.avatar_url || null, role: user.role || 'user' }
    } catch (e) { /* DB sibuk -> anggap anon, situs tetap jalan */ }
    next()
}

// ---- Middleware admin ----

async function resolveAdmin(req) {
    const token = parseCookies(req)[ADMIN_COOKIE]
    if (!token || !db.enabled()) return null
    try {
        const s = await store.findSession(token, 'admin')
        if (!s) return null
        const admin = await store.findAdminById(s.ref_id)
        return admin || null
    } catch (e) {
        return null
    }
}

async function requireAdmin(req, res, next) {
    const admin = await resolveAdmin(req)
    if (!admin) return res.redirect('/admin/login')
    req.admin = admin
    res.locals.admin = admin
    next()
}

function requireOwner(req, res, next) {
    if (!req.admin || req.admin.role !== 'owner') {
        return res.status(403).render('admin/denied', { admin: req.admin, section: '' })
    }
    next()
}

module.exports = {
    USER_COOKIE, ADMIN_COOKIE,
    parseCookies, setSessionCookie, clearCookie, cookieLine,
    loginRateOk, loginFailed, loginSucceeded,
    attachUser, requireAdmin, requireOwner
}
