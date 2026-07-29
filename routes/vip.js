// Halaman & proses VIP: info benefit, status VIP user, dan form permintaan
// VIP lewat donasi (di-approve manual oleh admin/owner di panel).
const express = require('express')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')
const settingsCache = require('../lib/settingsCache')

const VIA_OPTIONS = ['Trakteer', 'Saweria', 'DANA', 'QRIS', 'OVO', 'GoPay', 'Lainnya']

// GET /vip — halaman info + status + form permintaan
router.get('/', async (req, res) => {
    const base = {
        active: '', dbOn: db.enabled(),
        isVipNow: false, vipKind: null, vipUntil: null,
        pending: null, vipInfo: null, viaOptions: VIA_OPTIONS,
        flash: req.query.err ? { err: req.query.err } : (req.query.ok ? { ok: req.query.ok } : null)
    }
    if (!db.enabled()) return res.render('vip', base)
    try {
        const cfg = await settingsCache.getAll()
        base.vipInfo = cfg.vipInfo
        if (req.authUser) {
            base.isVipNow = store.isVip(req.authUser)
            base.vipKind = req.authUser.vip === true ? 'permanent' : (base.isVipNow ? 'temporer' : null)
            base.vipUntil = req.authUser.vip_until || null
            base.pending = await store.pendingVipRequest(req.authUser.id)
        }
        res.render('vip', base)
    } catch (e) {
        res.status(500).render('error', { error: 'Gagal memuat halaman VIP.' })
    }
})

// POST /vip/request — ajukan VIP via donasi (wajib login, 1 permintaan pending)
router.post('/request', async (req, res) => {
    if (!db.enabled()) return res.redirect('/vip')
    if (!req.authUser) return res.redirect('/login?next=' + encodeURIComponent('/vip'))
    const back = (q) => '/vip' + q + '#minta'

    const via = String(req.body.via || '')
    const proof = String(req.body.proof || '').replace(/\s+/g, ' ').trim()
    if (!VIA_OPTIONS.includes(via)) return res.redirect(back('?err=' + encodeURIComponent('Pilih metode donasi yang valid')))
    if (proof.length < 10 || proof.length > 300) {
        return res.redirect(back('?err=' + encodeURIComponent('Bukti keterangan 10-300 karakter (link/nomor referensi)')))
    }
    if (store.isVip(req.authUser) && req.authUser.vip === true) {
        return res.redirect(back('?err=' + encodeURIComponent('Kamu sudah VIP permanen 😎')))
    }

    try {
        if (await store.pendingVipRequest(req.authUser.id)) {
            return res.redirect(back('?err=' + encodeURIComponent('Masih ada permintaan yang menunggu diproses admin')))
        }
        await store.createVipRequest(req.authUser.id, via, proof)
        res.redirect(back('?ok=' + encodeURIComponent('Permintaan terkirim! Ditinjau admin manual (±1x24 jam)')))
    } catch (e) {
        res.redirect(back('?err=' + encodeURIComponent('Gagal mengirim permintaan')))
    }
})

module.exports = router
