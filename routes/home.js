const express = require('express')
const router = express.Router()
const settingsCache = require('../lib/settingsCache')

module.exports = (mobinime) => {
    router.get('/', async (req, res) => {
        try {
            // Konten dari admin panel: pengumuman & anime unggulan (default kosong bila DB off)
            const cfg = await settingsCache.getAll()

            const [homeData, featured] = await Promise.all([
                mobinime.fetchHomeData(),
                // Ambil detail anime unggulan secara paralel (detail sudah di-cache 30 mnt)
                Promise.all((cfg.featured || []).slice(0, 6).map(id =>
                    mobinime.detail(id).catch(() => null)
                )).then(list => list.filter(Boolean))
            ])

            res.render('index', {
                data: homeData,
                featured,
                announcement: cfg.announcement || { active: false, text: '' },
                active: 'home',
                query: null
            })
        } catch (error) {
            res.status(500).render('error', { error: error.message })
        }
    })

    return router
}
