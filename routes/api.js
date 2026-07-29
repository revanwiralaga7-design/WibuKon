// API JSON untuk sistem level (dipakai public/js/level.js di browser)
const express = require('express')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')
const levels = require('../lib/levels')
const expService = require('../lib/expService')
const settingsCache = require('../lib/settingsCache')

// GET /api/level/state — state EXP user (jika login) + konfigurasi rank/event
router.get('/level/state', async (req, res) => {
    try {
        const cfg = await settingsCache.getAll()
        const base = { user: null, config: { ranks: cfg.ranks, events: cfg.events } }

        if (!req.authUser) return res.json(base)

        const u = req.authUser
        const state = levels.stateFor(cfg.ranks, u.xp)
        const history = db.enabled() ? await store.recentXpEvents(u.id, 20) : []
        res.json({
            ...base,
            user: { id: u.id, username: u.username, role: u.role || 'user', vip: store.isVip(u), vipUntil: u.vip_until || null },
            state, history
        })
    } catch (e) {
        res.status(500).json({ user: null, error: 'server_error' })
    }
})

// POST /api/exp — klaim EXP sebuah event { event, uniq? }
router.post('/exp', async (req, res) => {
    if (!db.enabled()) return res.status(503).json({ ok: false, reason: 'no_db' })
    if (!req.authUser) return res.status(401).json({ ok: false, reason: 'not_logged_in' })

    const event = String(req.body.event || '')
    const uniq = req.body.uniq ? String(req.body.uniq) : null

    try {
        const result = await expService.grant(req.authUser, event, uniq)
        if (result.ok) req.authUser.xp = result.state.xp // sinkron utk request berikutnya
        res.json(result)
    } catch (e) {
        res.status(500).json({ ok: false, reason: 'server_error' })
    }
})

// GET /api/watched/:animeId — daftar episode yang sudah ditonton user (login).
// Tanpa DB / anon: ok:false -> klien fallback ke daftar lokal (localStorage).
router.get('/watched/:animeId', async (req, res) => {
    if (!db.enabled()) return res.json({ ok: false, reason: 'no_db' })
    if (!req.authUser) return res.status(401).json({ ok: false, reason: 'not_logged_in' })
    const animeId = String(req.params.animeId || '')
    if (!/^\d+$/.test(animeId)) return res.status(400).json({ ok: false, reason: 'bad_id' })
    try {
        const eps = await store.watchedForAnime(req.authUser.id, animeId)
        res.json({ ok: true, eps })
    } catch (e) {
        res.status(500).json({ ok: false, reason: 'server_error' })
    }
})

// POST /api/watched — tandai episode sudah ditonton { animeId, epsId } (idempoten)
router.post('/watched', async (req, res) => {
    if (!db.enabled()) return res.json({ ok: false, reason: 'no_db' })
    if (!req.authUser) return res.status(401).json({ ok: false, reason: 'not_logged_in' })
    const animeId = String(req.body.animeId || '')
    const epsId = String(req.body.epsId || '')
    if (!/^\d+$/.test(animeId) || !/^\d+$/.test(epsId)) {
        return res.status(400).json({ ok: false, reason: 'bad_id' })
    }
    try {
        await store.markWatchedDb(req.authUser.id, animeId, epsId)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ ok: false, reason: 'server_error' })
    }
})

module.exports = router
