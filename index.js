require('dotenv').config()
const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Mobinime = require('./lib/ServerData')
const db = require('./lib/db')
const migrate = require('./lib/migrate')
const { attachUser } = require('./lib/authUtil')
const setupRoutes = require('./routes')
const authRoute = require('./routes/auth')
const apiRoute = require('./routes/api')
const adminRoute = require('./routes/admin')
const chatRoute = require('./routes/chat')
const vipRoute = require('./routes/vip')

const app = express()
const port = process.env.PORT || 3000
const mobinime = new Mobinime()

// Versi aset JS dari isi file: URL berubah setiap deploy -> cache browser/CDN
// (Cloudflare) otomatis kebypass tanpa perlu clear cache manual.
function assetHash(file) {
    try {
        return crypto.createHash('md5')
            .update(fs.readFileSync(path.join(__dirname, 'public', file)))
            .digest('hex').slice(0, 8)
    } catch (e) { return '0' }
}
const ASSET_V = assetHash('js/app.js') + assetHash('js/level.js')
app.use((req, res, next) => { res.locals.assetV = ASSET_V; next() })

// Jalur DB penting di serverless: pastikan skema ada sebelum request
// pertama yang menyentuh DB (memoized — hanya migrasi sekali per proses).
app.use(async (req, res, next) => {
    try { await migrate.ensureMigrated() } catch (e) { console.error('[WibuKon] migrasi gagal:', e.message) }
    next()
})

app.use(express.static(path.join(__dirname, 'public')))
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// req.authUser/res.locals.authUser untuk semua halaman
app.use(attachUser)

// Urutan penting: auth/api/admin/chat SEBELUM rute publik (404 handler ada di dalamnya)
app.use('/', authRoute)
app.use('/api', apiRoute)
app.use('/admin', adminRoute(mobinime))
app.use('/chat', chatRoute)
app.use('/vip', vipRoute)

setupRoutes(app, mobinime)

if (require.main === module) {
    app.listen(port, () => {
        console.log(`WibuKon running at http://localhost:${port}`)
        if (!db.enabled()) console.log('[WibuKon] Mode tanpa database (DATABASE_URL kosong): fitur publik normal, akun/EXP/admin nonaktif.')
    })
}

module.exports = app
