// Panel admin WibuKon — SATU PINTU dengan akun user biasa.
// Masuk /admin wajib login akun (password/Google) ber-role admin/owner;
// sebagian route (konfigurasi rank, ubah role user) khusus OWNER.
const express = require('express')
const store = require('../lib/store')
const levels = require('../lib/levels')
const expService = require('../lib/expService')
const settingsCache = require('../lib/settingsCache')
const { requireAdmin, requireOwner } = require('../lib/authUtil')

module.exports = (mobinime) => {
    const router = express.Router()

    // URL lama (bookmark): dulu ada form login terpisah — sekarang dilempar
    // ke alur login akun biasa lewat requireAdmin -> /login?next=/admin
    router.get('/login', (req, res) => res.redirect('/admin'))
    router.get('/logout', (req, res) => res.redirect('/'))

    /* ================= SEMUA DI BAWAH INI WAJIB ADMIN/OWNER ================= */
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

    /* ---------- CATATAN ----------
       Tidak ada lagi halaman "kelola akun admin" terpisah: menaikkan/
       menurunkan admin cukup lewat Manajemen User -> ubah ROLE
       (POST /admin/users/:id/role, khusus OWNER di atas). */

    return router
}
