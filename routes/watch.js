const express = require('express')
const router = express.Router()
const db = require('../lib/db')
const store = require('../lib/store')
const settingsCache = require('../lib/settingsCache')

function rel(ts) {
    const diff = Date.now() - new Date(ts).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'baru saja'
    if (m < 60) return m + ' menit lalu'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' jam lalu'
    const d = Math.floor(h / 24)
    if (d < 30) return d + ' hari lalu'
    return new Date(ts).toLocaleDateString('id-ID')
}

function parseIds(req, res) {
    const animeId = req.params.animeSlug.split('-')[0]
    const epsId = req.params.epsSlug.split('-')[0]
    if (!/^\d+$/.test(animeId) || !/^\d+$/.test(epsId)) {
        res.status(404).render('404', { active: '' })
        return null
    }
    return { animeId, epsId }
}

function backUrl(animeSlug, epsSlug, query) {
    return `/watch/${animeSlug}/${epsSlug}${query || ''}#komentar`
}

module.exports = (mobinime) => {
    router.get('/:animeSlug/:epsSlug', async (req, res) => {
        try {
            const { animeSlug, epsSlug } = req.params
            const ids = parseIds(req, res)
            if (!ids) return
            const { animeId, epsId } = ids

            if ((await settingsCache.getBlacklistSet()).has(animeId)) {
                return res.status(404).render('404', { active: '' })
            }

            // stream & detail tidak saling bergantung -> dijalankan paralel.
            // Jika stream gagal, halaman TETAP tampil dengan daftar episode
            // (watch.ejs sudah punya fallback "Stream Error" untuk url null).
            const [streamUrl, detailData, comments, commentCount] = await Promise.all([
                mobinime.stream(animeId, epsId).catch(() => null),
                mobinime.detail(animeId),
                db.enabled() ? store.listComments(animeId, epsId, 50) : [],
                db.enabled() ? store.countComments(animeId, epsId) : 0
            ])

            res.render('watch', {
                url: streamUrl,
                anime: detailData,
                currentEps: epsId,
                active: 'home',
                comments: comments.map(c => ({ ...c, rel: rel(c.created_at) })),
                commentCount,
                commentsEnabled: db.enabled(),
                komenOk: req.query.ok || null,
                komenErr: req.query.err || null
            })
        } catch (error) {
            res.status(500).render('error', { error: error.message })
        }
    })

    // Kirim komentar (wajib login)
    router.post('/:animeSlug/:epsSlug/comment', async (req, res) => {
        const ids = parseIds(req, res)
        if (!ids) return
        const back = (q) => backUrl(req.params.animeSlug, req.params.epsSlug, q)

        if (!db.enabled()) return res.redirect(back())
        if (!req.authUser) {
            return res.redirect('/login?next=' + encodeURIComponent(`/watch/${req.params.animeSlug}/${req.params.epsSlug}`))
        }

        const body = String(req.body.body || '').replace(/\s+/g, ' ').trim()
        if (body.length < 1 || body.length > 500) {
            return res.redirect(back('?err=' + encodeURIComponent('Komentar 1-500 karakter')))
        }

        try {
            // Batasi: maksimal 1 komentar per 15 detik per user
            const last = await store.lastCommentAt(req.authUser.id)
            if (last && Date.now() - new Date(last).getTime() < 15000) {
                return res.redirect(back('?err=' + encodeURIComponent('Terlalu cepat — tunggu 15 detik antar komentar')))
            }
            await store.addComment(req.authUser.id, ids.animeId, ids.epsId, body)
            res.redirect(back('?ok=' + encodeURIComponent('Komentar terkirim')))
        } catch (e) {
            res.redirect(back('?err=' + encodeURIComponent('Gagal mengirim komentar')))
        }
    })

    // Hapus komentar: pemilik komentar ATAU staff (role admin/owner)
    router.post('/comment/:id/delete', async (req, res) => {
        const back = typeof req.body.next === 'string' && req.body.next.startsWith('/watch/')
            ? req.body.next : '/'
        if (!db.enabled()) return res.redirect(back)
        try {
            const c = await store.findComment(parseInt(req.params.id))
            if (!c) return res.redirect(back + '#komentar')
            const u = req.authUser
            const isOwner = u && u.id === c.user_id
            const isStaff = u && (u.role === 'admin' || u.role === 'owner')
            if (!isOwner && !isStaff) return res.status(403).render('error', { error: 'Tidak boleh menghapus komentar orang lain.' })
            await store.deleteComment(c.id)
            res.redirect(back + '#komentar')
        } catch (e) {
            res.redirect(back + '#komentar')
        }
    })

    return router
}
