const express = require('express')
const router = express.Router()

module.exports = () => {
    router.get('/', (req, res) => {
        // Data bookmark tersimpan di localStorage browser user,
        // server hanya merender kerangka halaman — JS di client yang mengisi isinya.
        res.render('bookmarks', { active: 'bookmarks' })
    })

    return router
}
