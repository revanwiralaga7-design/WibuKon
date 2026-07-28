// Cache in-memory sederhana dengan TTL — tanpa dependency tambahan.
// Satu instance dipakai bersama, jadi juga tetap hidup di warm state serverless (Vercel).
class TTLCache {
    constructor(maxSize = 500) {
        this.store = new Map()
        this.maxSize = maxSize
    }

    get(key) {
        const hit = this.store.get(key)
        if (!hit) return null
        if (Date.now() > hit.expires) {
            this.store.delete(key)
            return null
        }
        return hit.value
    }

    set(key, value, ttlMs) {
        if (this.store.size >= this.maxSize) {
            // Map menyimpan urutan insert — buang entry paling lama
            this.store.delete(this.store.keys().next().value)
        }
        this.store.set(key, { value, expires: Date.now() + ttlMs })
    }
}

module.exports = new TTLCache()
