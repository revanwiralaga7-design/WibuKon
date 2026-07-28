const express = require('express')
const router = express.Router()

const PER_PAGE = 25

module.exports = (mobinime) => {
    router.get('/', async (req, res) => {
        const query = req.query.q
        if (!query) return res.redirect('/')

        const page = /^\d+$/.test(req.query.page || '') ? req.query.page : '0'
        // Mode JSON dipakai tombol "Muat Lebih" di browser
        const wantsJson = req.query.json === '1' || req.xhr

        try {
            const searchResults = await mobinime.search(query, { page, count: String(PER_PAGE) })
            // Heuristik: kalau hasil penuh satu halaman, kemungkinan masih ada halaman berikutnya
            const hasMore = searchResults.length >= PER_PAGE

            if (wantsJson) {
                return res.json({ results: searchResults, page: Number(page), hasMore })
            }

            res.render('search', {
                data: searchResults,
                active: 'search',
                query: query,
                page: Number(page),
                hasMore: hasMore
            })
        } catch (error) {
            if (wantsJson) {
                return res.status(500).json({ results: [], page: Number(page), hasMore: false, error: error.message })
            }
            res.render('search', {
                data: [],
                active: 'search',
                query: query,
                page: 0,
                hasMore: false
            })
        }
    })

    return router
}
