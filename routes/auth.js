// Auth user publik: register / login (password) + Login Google (OAuth 2.0) / logout
const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')
const { hashPassword, verifyPassword } = require('../lib/cryptoUtil')
const { USER_COOKIE, setSessionCookie, clearCookie, cookieLine, parseCookies, loginRateOk, loginFailed, loginSucceeded, maybeBootstrapOwner } = require('../lib/authUtil')

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
// URL endpoint ini dioverride saat testing (stub lokal)
const GOOGLE_TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
const GOOGLE_TOKENINFO_URL = () => process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo'

function googleEnabled() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function baseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
    return `${proto}://${req.headers.host}`
}

function safeNext(next) {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function noDb(res) {
    return res.status(503).render('error', { error: 'Fitur akun belum aktif: DATABASE_URL belum dikonfigurasi.' })
}

/* ==================== REGISTER & LOGIN PASSWORD ==================== */

router.get('/register', (req, res) => {
    if (!db.enabled()) return noDb(res)
    if (req.authUser) return res.redirect('/level')
    res.render('register', { active: '', error: null, username: '', google: googleEnabled() })
})

router.post('/register', async (req, res) => {
    if (!db.enabled()) return noDb(res)
    const username = String(req.body.username || '').toLowerCase().trim()
    const password = String(req.body.password || '')

    if (!USERNAME_RE.test(username) || password.length < 6) {
        return res.status(400).render('register', {
            active: '', username, google: googleEnabled(),
            error: 'Username 3-20 karakter (huruf/angka/underscore) & password minimal 6 karakter.'
        })
    }

    try {
        const user = await store.createUser(username, hashPassword(password))
        await maybeBootstrapOwner(user) // cocok env & belum ada owner -> jadi OWNER
        const s = await store.createSession('user', user.id)
        setSessionCookie(res, req, USER_COOKIE, s.token)
        res.redirect('/level')
    } catch (e) {
        const taken = e && e.code === '23505'
        res.status(taken ? 409 : 500).render('register', {
            active: '', username, google: googleEnabled(),
            error: taken ? 'Username sudah dipakai, coba yang lain.' : 'Gagal mendaftar, coba lagi.'
        })
    }
})

router.get('/login', (req, res) => {
    if (!db.enabled()) return noDb(res)
    if (req.authUser) return res.redirect('/level')
    res.render('login', { active: '', error: null, next: safeNext(req.query.next), google: googleEnabled() })
})

router.post('/login', async (req, res) => {
    if (!db.enabled()) return noDb(res)
    const nextUrl = safeNext(req.body.next)
    const ip = req.ip || 'unknown'

    if (!loginRateOk(ip)) {
        return res.status(429).render('login', { active: '', next: nextUrl, google: googleEnabled(), error: 'Terlalu banyak percobaan. Coba lagi 10 menit.' })
    }

    try {
        const user = await store.findUserByName(String(req.body.username || '').trim())
        const bad = !user || !user.password_hash || !verifyPassword(String(req.body.password || ''), user.password_hash)
        if (bad) {
            loginFailed(ip)
            const hint = user && !user.password_hash ? 'Akun ini dibuat lewat Google — gunakan tombol Masuk dengan Google.' : 'Username atau password salah.'
            return res.status(401).render('login', { active: '', next: nextUrl, google: googleEnabled(), error: hint })
        }
        if (user.is_banned) {
            return res.status(403).render('login', { active: '', next: nextUrl, google: googleEnabled(), error: 'Akun ini diblokir. Hubungi admin.' })
        }
        loginSucceeded(ip)
        await maybeBootstrapOwner(user)
        const s = await store.createSession('user', user.id)
        setSessionCookie(res, req, USER_COOKIE, s.token)
        res.redirect(nextUrl)
    } catch (e) {
        res.status(500).render('login', { active: '', next: nextUrl, google: googleEnabled(), error: 'Server sibuk, coba lagi.' })
    }
})

/* ==================== LOGIN GOOGLE (OAuth 2.0 code flow) ==================== */

const GSTATE_COOKIE = 'wb_gstate'

router.get('/auth/google', (req, res) => {
    if (!db.enabled()) return noDb(res)
    if (!googleEnabled()) {
        return res.status(503).render('login', {
            active: '', next: '/', google: false,
            error: 'Login Google belum dikonfigurasi (GOOGLE_CLIENT_ID/SECRET kosong).'
        })
    }

    const state = crypto.randomBytes(16).toString('hex')
    const nextUrl = safeNext(req.query.next)

    // state disimpan di cookie sementara (10 mnt) untuk anti-CSRF,
    // sekaligus membawa tujuan redirect setelah login
    res.append('Set-Cookie', cookieLine(GSTATE_COOKIE, `${state}|${nextUrl}`, 600, req))

    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${baseUrl(req)}/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account'
    })
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`)
})

router.get('/auth/google/callback', async (req, res) => {
    const fail = (msg) => res.status(400).render('login', { active: '', next: '/', google: googleEnabled(), error: msg })
    if (!db.enabled()) return noDb(res)
    if (!googleEnabled()) return fail('Login Google belum dikonfigurasi.')

    // Verifikasi state (anti-CSRF)
    const jar = parseCookies(req)
    const [savedState, savedNext] = String(jar[GSTATE_COOKIE] || '').split('|')
    clearCookie(res, req, GSTATE_COOKIE)
    const nextUrl = safeNext(savedNext)

    if (req.query.error) return fail(`Login dibatalkan: ${req.query.error}`)
    if (!savedState || !req.query.state || req.query.state !== savedState) return fail('Sesi login tidak valid (state mismatch). Coba lagi.')
    if (!req.query.code) return fail('Google tidak mengirim kode otorisasi.')

    try {
        // 1. Tukar kode -> token
        const tokenRes = await fetch(GOOGLE_TOKEN_URL(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(req.query.code),
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${baseUrl(req)}/auth/google/callback`,
                grant_type: 'authorization_code'
            })
        })
        const tokens = await tokenRes.json().catch(() => ({}))
        if (!tokenRes.ok || !tokens.id_token) return fail('Gagal menukar kode dengan Google.')

        // 2. Verifikasi id_token via endpoint Google (pastikan aud = client kita)
        const infoRes = await fetch(`${GOOGLE_TOKENINFO_URL()}?id_token=${encodeURIComponent(tokens.id_token)}`)
        const info = await infoRes.json().catch(() => ({}))
        if (!infoRes.ok || info.aud !== process.env.GOOGLE_CLIENT_ID || !info.sub) {
            return fail('Verifikasi identitas Google gagal.')
        }
        if (info.email_verified === 'false' || info.email_verified === false) {
            return fail('Email Google belum terverifikasi.')
        }

        // 3. Link akun lama (google_id sama) atau buat akun baru
        let user = await store.findUserByGoogleId(info.sub)
        if (user && user.is_banned) {
            return res.status(403).render('login', { active: '', next: '/', google: true, error: 'Akun ini diblokir. Hubungi admin.' })
        }
        if (!user) {
            const baseName = info.name || (info.email || 'wibu').split('@')[0]
            const username = await uniqueUsername(baseName)
            user = await store.createGoogleUser({
                username,
                googleId: info.sub,
                email: info.email || null,
                avatarUrl: info.picture || null
            })
        } else if (info.picture && info.picture !== user.avatar_url) {
            await store.updateGoogleProfile(user.id, info.picture)
            user.avatar_url = info.picture
        }

        // 4. Bootstrap owner bila cocok env lalu terbitkan sesi seperti login biasa
        await maybeBootstrapOwner(user)
        const s = await store.createSession('user', user.id)
        setSessionCookie(res, req, USER_COOKIE, s.token)
        res.redirect(nextUrl === '/' ? '/level' : nextUrl)
    } catch (e) {
        console.error('[WibuKon] Google login error:', e.message)
        res.status(500).render('login', { active: '', next: '/', google: googleEnabled(), error: 'Login Google gagal, coba lagi.' })
    }
})

// Username unik dari nama/email Google (slug aman, suffix acak bila tabrakan)
async function uniqueUsername(base) {
    let clean = String(base || 'wibu').toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (clean.length < 3) clean = 'wibu_' + clean
    clean = clean.slice(0, 14)
    for (let i = 0; i < 10; i++) {
        const candidate = i === 0 ? clean : `${clean}_${crypto.randomInt(1000, 9999)}`
        if (!(await store.findUserByName(candidate))) return candidate
    }
    return `wibu${crypto.randomInt(100000, 999999)}`
}

/* ==================== LOGOUT ==================== */

router.get('/logout', async (req, res) => {
    if (db.enabled()) {
        try {
            const token = parseCookies(req)[USER_COOKIE]
            if (token) await store.deleteSession(token)
        } catch (e) {}
    }
    clearCookie(res, req, USER_COOKIE)
    res.redirect('/')
})

module.exports = router
