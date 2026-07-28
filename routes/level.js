const express = require('express')
const router = express.Router()

module.exports = () => {
    router.get('/', (req, res) => {
        // Data level tersimpan di localStorage browser user,
        // server hanya merender kerangka — JS client yang mengisi.
        res.render('level', { active: 'level' })
    })

    return router
}
