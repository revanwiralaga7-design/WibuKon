// Panel admin WibuKon — semua route /admin/* dilindungi requireAdmin,
// sebagian (konfigurasi rank & kelola admin) hanya untuk role OWNER.
const express = require('express')
const db = require('../lib/db')
const store = require('../lib/store')
const levels = require('../lib/levels')
const expService = require('../lib/expService')
const settingsCache = require('../lib/settingsCache')
const { hashPassword, verifyPassword } = require('../lib/cryptoUtil')
const {
    ADMIN_COOKIE, setSessionCookie, clearCookie, parseCookies,
    loginRateOk, loginFailed, loginSucceeded, requireAdmin, requireOwner
} = require('../lib/authUtil')

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

module.exports = (mobinime) => {
    const router = express.Router()

    /* ================= AUTH ADMIN ================= */

    router.get('/login', async (req, res) => {
        if (!db.enabled()) return res.status(503).render('error', { error: 'DATABASE_URL belum dikonfigurasi — panel admin nonaktif.' })
        try {
            const token = parseCookies(req)[ADMIN_COOKIE]
            if (token && await store.findSession(token, 'admin')) return res.redirect('/admin')
        } catch (e) {}
        res.render('admin/login', { error: null })
    })

    router.post('/login', async (req, res) => {
        if (!db.enabled()) return res.status(503).render('error', { error: 'DATABASE_URL belum dikonfigurasi.' })
        const ip = req.ip || 'unknown'
        if (!loginRateOk(ip)) return res.status(429).render('admin/login', { error: 'Terlalu banyak percobaan. Coba lagi 10 menit.' })

        try {
            const admin = await store.findAdminByName(String(req.body.username || '').trim())
            if (!admin || !verifyPassword(String(req.body.password || ''), admin.password_hash)) {
                loginFailed(ip)
                return res.status(401).render('admin/login', { error: 'Username atau password salah.' })
            }
            loginSucceeded(ip)
            const s = await store.createSession('admin', admin.id)
            setSessionCookie(res, req, ADMIN_COOKIE, s.token)
            res.redirect('/admin')
        } catch (e) {
            res.status(500).render('admin/login', { error: 'Server sibuk, coba lagi.' })
        }
    })

    router.get('/logout', async (req, res) => {
        try {
            const token = parseCookies(req)[ADMIN_COOKIE]
            if (token) await store.deleteSession(token)
        } catch (e) {}
        clearCookie(res, req, ADMIN_COOKIE)
        res.redirect('/admin/login')
    })

    /* ================= SEMUA DI BAWAH INI WAJIB ADMIN ================= */
    router.use(requireAdmin)

    /* ---------- DASHBOARD ---------- */
    router.get('/', async (req, res) => {
        try {
            const cfg = await settingsCache.getAll()
            const [s, xpList, newest] = await Promise.all([
                store.stats(), store.allUserXp(), store.newestUsers(5)
            ])
            // Distribusi user per rank
            const dist = cfg.ranks.map((r, i) => {
                const max = i + 1 < cfg.ranks.length ? cfg.ranks[i + 1].min - 1 : Infinity
                return { ...r, count: 0, maxLevel: max }
            })
            for (const xp of xpList) {
                const st = levels.stateFor(cfg.ranks, xp)
                const idx = cfg.ranks.findIndex(r => r.name === st.rank.name)
                if (idx >= 0) dist[idx].count++
            }
            res.render('admin/dashboard', { section: 'dashboard', s, dist, newest, ranks: cfg.ranks, flash: req.query.ok ? { ok: req.query.ok } : null })
        } catch (e) {
            res.status(500).render('admin/denied', { admin: req.admin, section: 'dashboard', message: e.message })
        }
    })

    /* ---------- MANAJEMEN USER ---------- */
    router.get('/users', async (req, res) => {
        try {
            const q = String(req.query.q || '').trim().slice(0, 40)
            const page = Math.max(1, parseInt(req.query.page) || 1)
            const per = 20
            const cfg = await settingsCache.getAll()
            const [rows, total] = await Promise.all([store.listUsers(q, per, (page - 1) * per), store.countUsers(q)])
            const users = rows.map(u => ({ ...u, st: levels.stateFor(cfg.ranks, u.xp) }))
            res.render('admin/users', { section: 'users', users, q, page, pages: Math.max(1, Math.ceil(total / per)), total, flash: null })
        } catch (e) {
            res.status(500).render('admin/denied', { admin: req.admin, section: 'users', message: e.message })
        }
    })

    router.get('/users/:id', async (req, res) => {
        try {
            const cfg = await settingsCache.getAll()
            const user = await store.findUserById(parseInt(req.params.id))
            if (!user) return res.redirect('/admin/users')
            const events = await store.recentXpEvents(user.id, 30)
            res.render('admin/user-detail', {
                section: 'users', user, st: levels.stateFor(cfg.ranks, user.xp), events,
                flash: req.query.ok ? { ok: req.query.ok } : (req.query.err ? { err: req.query.err } : null)
            })
        } catch (e) {
            res.status(500).render('admin/denied', { admin: req.admin, section: 'users', message: e.message })
        }
    })

    router.post('/users/:id/exp', async (req, res) => {
        try {
            const user = await store.findUserById(parseInt(req.params.id))
            if (!user) return res.redirect('/admin/users')
            const delta = Math.round(Number(req.body.delta))
            if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000000) {
                return res.redirect(`/admin/users/${user.id}?err=` + encodeURIComponent('Delta EXP tidak valid'))
            }
            const r = await expService.adminAdjust(req.admin, user, delta, String(req.body.reason || '').trim())
            if (!r.ok) return res.redirect(`/admin/users/${user.id}?err=` + encodeURIComponent(r.reason))
            res.redirect(`/admin/users/${user.id}?ok=` + encodeURIComponent(`EXP ${user.username}: ${r.before.xp} -> ${r.after.xp}`))
        } catch (e) {
            res.redirect(`/admin/users/${req.params.id}?err=` + encodeURIComponent('Gagal menyesuaikan EXP'))
        }
    })

    router.post('/users/:id/ban', async (req, res) => {
        try {
            const user = await store.findUserById(parseInt(req.params.id))
            if (user) await store.setBanned(user.id, !user.is_banned)
            res.redirect(`/admin/users/${req.params.id}?ok=` + encodeURIComponent(user && user.is_banned ? 'User dibuka blokirnya' : 'User diblokir'))
        } catch (e) {
            res.redirect(`/admin/users/${req.params.id}?err=` + encodeURIComponent('Gagal mengubah status'))
        }
    })

    // Ubah ROLE user publik (user/admin/owner) — khusus OWNER.
    // Role menentukan badge di komentar/leaderboard & hak hapus komentar orang.
    router.post('/users/:id/role', requireOwner, async (req, res) => {
        try {
            const role = String(req.body.role || '')
            if (!['user', 'admin', 'owner'].includes(role)) {
                return res.redirect(`/admin/users/${req.params.id}?err=` + encodeURIComponent('Role tidak valid'))
            }
            const user = await store.findUserById(parseInt(req.params.id))
            if (!user) return res.redirect('/admin/users')
            await store.setUserRole(user.id, role)
            res.redirect(`/admin/users/${user.id}?ok=` + encodeURIComponent(`Role ${user.username} -> ${role.toUpperCase()}`))
        } catch (e) {
            res.redirect(`/admin/users/${req.params.id}?err=` + encodeURIComponent('Gagal mengubah role'))
        }
    })

    /* ---------- KONTROL KONTEN (announcement / featured / blacklist) ---------- */
    router.get('/content', async (req, res) => {
        try {
            const cfg = await settingsCache.getAll()
            // Preview judul anime featured dari API (maks 6, gagal di-skip)
            const previews = (await Promise.all(
                (cfg.featured || []).slice(0, 6).map(id => mobinime.detail(id).then(d => ({ id, ...d })).catch(() => null))
            )).filter(Boolean)
            res.render('admin/content', {
                section: 'content', cfg, previews,
                flash: req.query.ok ? { ok: req.query.ok } : (req.query.err ? { err: req.query.err } : null)
            })
        } catch (e) {
            res.status(500).render('admin/denied', { admin: req.admin, section: 'content', message: e.message })
        }
    })

    const parseIdList = (raw, max) =>
        String(raw || '').split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s))
            .filter((v, i, a) => a.indexOf(v) === i).slice(0, max)

    router.post('/content', async (req, res) => {
        const form = String(req.body.form || '')
        try {
            if (form === 'announcement') {
                const text = String(req.body.text || '').trim().slice(0, 500)
                await settingsCache.set('announcement', { active: req.body.active === 'on', text })
                return res.redirect('/admin/content?ok=Pengumuman disimpan')
            }
            if (form === 'featured') {
                const ids = parseIdList(req.body.ids, 20)
                await settingsCache.set('featured', ids)
                return res.redirect('/admin/content?ok=' + encodeURIComponent(`Daftar unggulan disimpan (${ids.length} anime)`))
            }
            if (form === 'blacklist') {
                const ids = parseIdList(req.body.ids, 500)
                await settingsCache.set('blacklist', ids)
                return res.redirect('/admin/content?ok=' + encodeURIComponent(`Blacklist disimpan (${ids.length} anime)`))
            }
            res.redirect('/admin/content?err=Form tidak dikenal')
        } catch (e) {
            res.redirect('/admin/content?err=' + encodeURIComponent('Gagal menyimpan'))
        }
    })

    /* ---------- KONFIGURASI RANK & EVENT (khusus OWNER) ---------- */
    router.get('/ranks', requireOwner, async (req, res) => {
        const cfg = await settingsCache.getAll()
        res.render('admin/ranks', {
            section: 'ranks', cfg,
            flash: req.query.ok ? { ok: req.query.ok } : (req.query.err ? { err: req.query.err } : null)
        })
    })

    router.post('/ranks', requireOwner, async (req, res) => {
        try {
            const ranks = levels.validateRanks(JSON.parse(String(req.body.ranks || '[]')))
            const events = levels.validateEvents(JSON.parse(String(req.body.events || '{}')))
            await settingsCache.set('ranks', ranks)
            await settingsCache.set('events', events)
            res.redirect('/admin/ranks?ok=Konfigurasi rank & event disimpan')
        } catch (e) {
            res.redirect('/admin/ranks?err=' + encodeURIComponent(String(e.message || e).slice(0, 200)))
        }
    })

    /* ---------- KELOLA AKUN ADMIN (khusus OWNER) ---------- */
    router.get('/admins', requireOwner, async (req, res) => {
        const admins = await store.listAdmins()
        res.render('admin/admins', {
            section: 'admins', admins,
            flash: req.query.ok ? { ok: req.query.ok } : (req.query.err ? { err: req.query.err } : null)
        })
    })

    router.post('/admins', requireOwner, async (req, res) => {
        const username = String(req.body.username || '').toLowerCase().trim()
        const password = String(req.body.password || '')
        const role = req.body.role === 'owner' ? 'owner' : 'admin'
        if (!USERNAME_RE.test(username) || password.length < 8) {
            return res.redirect('/admin/admins?err=' + encodeURIComponent('Username 3-20 karakter & password minimal 8 karakter'))
        }
        try {
            await store.createAdmin(username, hashPassword(password), role)
            res.redirect('/admin/admins?ok=' + encodeURIComponent(`Admin "${username}" (${role}) dibuat`))
        } catch (e) {
            res.redirect('/admin/admins?err=' + encodeURIComponent(e.code === '23505' ? 'Username sudah dipakai' : 'Gagal membuat admin'))
        }
    })

    router.post('/admins/:id/delete', requireOwner, async (req, res) => {
        try {
            const target = await store.findAdminById(parseInt(req.params.id))
            if (!target) return res.redirect('/admin/admins?err=Admin tidak ditemukan')
            if (target.id === req.admin.id) return res.redirect('/admin/admins?err=' + encodeURIComponent('Tidak bisa menghapus akun sendiri'))
            if (target.role === 'owner') return res.redirect('/admin/admins?err=' + encodeURIComponent('Akun owner tidak bisa dihapus'))
            await store.deleteAdmin(target.id)
            res.redirect('/admin/admins?ok=' + encodeURIComponent(`Admin "${target.username}" dihapus`))
        } catch (e) {
            res.redirect('/admin/admins?err=' + encodeURIComponent('Gagal menghapus'))
        }
    })

    return router
}
