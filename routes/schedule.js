const express = require('express')
const router = express.Router()

module.exports = (mobinime) => {
    router.get('/', async (req, res) => {
        try {
            const homeData = await mobinime.fetchHomeData()
            res.render('schedule', {
                schedule: homeData.schedule,
                active: 'schedule'
            })
        } catch (error) {
            res.status(500).render('error', { error: error.message })
        }
    })

    return router
}
