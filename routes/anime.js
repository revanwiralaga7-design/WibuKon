const express = require('express')
const router = express.Router()
const settingsCache = require('../lib/settingsCache')

module.exports = (mobinime) => {
    router.get('/:slug', async (req, res) => {
        try {
            const id = req.params.slug.split('-')[0]

            // ID anime selalu numerik — tolak slug aneh sebelum menyentuh API
            if (!/^\d+$/.test(id)) {
                return res.status(404).render('404', { active: '' })
            }

            // Anime yang di-blacklist admin disembunyikan
            if ((await settingsCache.getBlacklistSet()).has(id)) {
                return res.status(404).render('404', { active: '' })
            }

            const detailData = await mobinime.detail(id)
            res.render('detail', { anime: detailData, active: 'home' })
        } catch (error) {
            res.status(500).render('error', { error: error.message })
        }
    })

    return router
}
