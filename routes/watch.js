const express = require('express')
const router = express.Router()
const settingsCache = require('../lib/settingsCache')

module.exports = (mobinime) => {
    router.get('/:animeSlug/:epsSlug', async (req, res) => {
        try {
            const { animeSlug, epsSlug } = req.params
            const animeId = animeSlug.split('-')[0]
            const epsId = epsSlug.split('-')[0]

            if (!/^\d+$/.test(animeId) || !/^\d+$/.test(epsId)) {
                return res.status(404).render('404', { active: '' })
            }

            if ((await settingsCache.getBlacklistSet()).has(animeId)) {
                return res.status(404).render('404', { active: '' })
            }

            // stream & detail tidak saling bergantung -> dijalankan paralel.
            // Jika stream gagal, halaman TETAP tampil dengan daftar episode
            // (watch.ejs sudah punya fallback "Stream Error" untuk url null).
            const [streamUrl, detailData] = await Promise.all([
                mobinime.stream(animeId, epsId).catch(() => null),
                mobinime.detail(animeId)
            ])

            res.render('watch', {
                url: streamUrl,
                anime: detailData,
                currentEps: epsId,
                active: 'home'
            })
        } catch (error) {
            res.status(500).render('error', { error: error.message })
        }
    })

    return router
}
