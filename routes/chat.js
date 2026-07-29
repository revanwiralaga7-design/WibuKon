// Chat global WibuKon — ruang ngobrol semua user (1 ruang untuk seluruh situs).
// Baca: bebas (tamu boleh). Kirim: wajib login. Realtime via polling JSON tiap 4 dtk.
const express = require('express')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')
const levels = require('../lib/levels')
const settingsCache = require('../lib/settingsCache')

const RATE_MS = 3000   // jeda minimal antar pesan per user
const MAX_BODY = 280   // maks karakter per pesan

function rel(ts) {
    const diff = Date.now() - new Date(ts).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'baru saja'
    if (m < 60) return m + ' mnt'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' jam'
    const d = Math.floor(h / 24)
    if (d < 30) return d + ' hari'
    return new Date(ts).toLocaleDateString('id-ID')
}

function withLv(rows, ranks) {
    return rows.map(m => ({ ...m, rel: rel(m.created_at), lv: levels.stateFor(ranks, m.xp || 0) }))
}

// Bentuk JSON aman untuk klien polling (tanpa field sensitif)
function toJson(m) {
    return {
        id: m.id, body: m.body, rel: m.rel,
        userId: m.user_id, username: m.username,
        avatar: m.avatar_url || null, role: m.role || 'user',
        lv: { level: m.lv.level, xp: m.lv.xp, name: m.lv.rank.name, icon: m.lv.rank.icon, color: m.lv.rank.color }
    }
}

function validateBody(raw) {
    const body = String(raw || '').replace(/\s+/g, ' ').trim()
    if (body.length < 1) return { err: 'Pesan tidak boleh kosong' }
    if (body.length > MAX_BODY) return { err: `Pesan maksimal ${MAX_BODY} karakter` }
    return { body }
}

// Validasi + rate limit + simpan. Dipakai jalur form & jalur JSON.
async function tryPost(user, rawBody) {
    const v = validateBody(rawBody)
    if (v.err) return { ok: false, reason: v.err }
    const last = await store.lastChatAt(user.id)
    if (last && Date.now() - new Date(last).getTime() < RATE_MS) {
        return { ok: false, reason: 'Santai — jeda 3 detik antar pesan' }
    }
    const row = await store.addChatMessage(user.id, v.body)
    return { ok: true, id: row.id }
}

// GET /chat — halaman chat (50 pesan terakhir, terlama -> terbaru)
router.get('/', async (req, res) => {
    if (!db.enabled()) {
        return res.render('chat', {
            active: 'chat', chatEnabled: false, messages: [],
            flash: null
        })
    }
    try {
        const cfg = await settingsCache.getAll()
        const messages = withLv(await store.listChat(50), cfg.ranks)
        res.render('chat', {
            active: 'chat', chatEnabled: true, messages,
            flash: req.query.err ? { err: req.query.err } : (req.query.ok ? { ok: req.query.ok } : null)
        })
    } catch (e) {
        res.status(500).render('error', { error: 'Gagal memuat chat.' })
    }
})

// POST /chat — fallback tanpa JS (form biasa, redirect balik)
router.post('/', async (req, res) => {
    if (!db.enabled()) return res.redirect('/chat')
    if (!req.authUser) return res.redirect('/login?next=' + encodeURIComponent('/chat'))
    try {
        const r = await tryPost(req.authUser, req.body.body)
        res.redirect('/chat' + (r.ok ? '' : '?err=' + encodeURIComponent(r.reason)) + '#kirim')
    } catch (e) {
        res.redirect('/chat?err=' + encodeURIComponent('Gagal mengirim pesan') + '#kirim')
    }
})

// GET /chat/api?after=N — polling pesan baru (JSON)
router.get('/api', async (req, res) => {
    if (!db.enabled()) return res.json({ ok: false, reason: 'no_db' })
    const after = /^\d+$/.test(String(req.query.after || '')) ? parseInt(req.query.after) : 0
    try {
        const cfg = await settingsCache.getAll()
        const rows = withLv(await store.listChat(100, after || null), cfg.ranks)
        res.json({ ok: true, messages: rows.map(toJson) })
    } catch (e) {
        res.status(500).json({ ok: false, reason: 'server_error' })
    }
})

// POST /chat/api — kirim pesan via fetch (JSON)
router.post('/api', async (req, res) => {
    if (!db.enabled()) return res.status(503).json({ ok: false, reason: 'no_db' })
    if (!req.authUser) return res.status(401).json({ ok: false, reason: 'not_logged_in' })
    try {
        const r = await tryPost(req.authUser, req.body.body)
        if (!r.ok) return res.status(400).json(r)
        res.json({ ok: true, id: r.id })
    } catch (e) {
        res.status(500).json({ ok: false, reason: 'server_error' })
    }
})

// POST /chat/:id/delete — pemilik pesan ATAU staff (admin/owner)
router.post('/:id/delete', async (req, res) => {
    if (!db.enabled()) return res.redirect('/chat')
    try {
        const m = await store.findChatMessage(parseInt(req.params.id))
        if (m) {
            const u = req.authUser
            const isOwn = u && u.id === m.user_id
            const isStaff = u && (u.role === 'admin' || u.role === 'owner')
            if (!isOwn && !isStaff) {
                return res.status(403).render('error', { error: 'Tidak boleh menghapus pesan orang lain.' })
            }
            await store.deleteChatMessage(m.id)
        }
    } catch (e) { /* diamkan, kembali ke chat */ }
    res.redirect('/chat')
})

module.exports = router
