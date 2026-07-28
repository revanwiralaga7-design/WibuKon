// Papan peringkat EXP: harian / mingguan / bulanan / semua waktu
const express = require('express')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')

const PERIODS = {
    harian:  { label: 'Hari Ini',       days: 1 },
    mingguan:{ label: '7 Hari Terakhir', days: 7 },
    bulanan: { label: '30 Hari Terakhir', days: 30 },
    semua:   { label: 'Semua Waktu',    days: null }
}
const TOP = 50

function sinceDay(days) {
    // batas tanggal UTC: hari ini dikurangi (days-1)
    return new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
    if (!db.enabled()) {
        return res.status(503).render('error', { error: 'Leaderboard butuh database (DATABASE_URL belum diset).' })
    }
    const p = PERIODS[req.query.p] ? req.query.p : 'harian'
    const period = PERIODS[p]

    try {
        let rows, me = null
        if (p === 'semua') {
            rows = await store.topAllTime(TOP)
        } else {
            rows = await store.topSince(sinceDay(period.days), TOP)
        }

        if (req.authUser) {
            const u = req.authUser
            if (p === 'semua') {
                me = { username: u.username, amount: u.xp, rank: await store.myRankAll(u.xp) }
            } else {
                const sum = await store.mySumSince(u.id, sinceDay(period.days))
                me = { username: u.username, amount: sum, rank: sum > 0 ? await store.myRankSince(sinceDay(period.days), sum) : null }
            }
            me.inTop = rows.some(r => r.id === u.id)
        }

        res.render('leaderboard', { active: 'leaderboard', rows, me, p, period, periods: PERIODS })
    } catch (e) {
        res.status(500).render('error', { error: e.message })
    }
})

module.exports = router
