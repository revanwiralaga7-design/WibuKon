// Cache konfigurasi settings dari DB (TTL 60 detik) supaya tidak query
// ke Postgres di setiap request publik. Jika DB mati/nonaktif -> nilai default.
const db = require('./db')
const store = require('./store')
const defaults = require('./defaults')

let cache = { at: 0, data: null }
const TTL = 60 * 1000

async function getAll() {
    if (!db.enabled()) return defaults.defaultSettings()
    if (cache.data && Date.now() - cache.at < TTL) return cache.data
    try {
        cache.data = await store.getSettings()
        cache.at = Date.now()
    } catch (e) {
        if (!cache.data) cache.data = defaults.defaultSettings()
    }
    return cache.data
}

async function set(key, value) {
    await store.setSetting(key, value)
    cache.at = 0 // invalidasi — request berikutnya ambil ulang dari DB
}

async function getBlacklistSet() {
    const cfg = await getAll()
    return new Set((cfg.blacklist || []).map(String))
}

module.exports = { getAll, set, getBlacklistSet }
