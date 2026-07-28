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
        res.json({ ...base, user: { id: u.id, username: u.username }, state, history })
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

module.exports = router
