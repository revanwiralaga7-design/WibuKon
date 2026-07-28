// Koneksi PostgreSQL. Aktif hanya jika DATABASE_URL diset —
// tanpa env itu situs PUBLIK tetap jalan normal (mode tanpa DB),
// hanya fitur akun/EXP/admin yang nonaktif.
const { Pool } = require('pg')

let pool = null

function enabled() {
    return Boolean(process.env.DATABASE_URL)
}

function getPool() {
    if (!enabled()) return null
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            // Kebanyakan Postgres managed (Neon, Supabase) butuh SSL
            ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        })
    }
    return pool
}

async function q(text, params) {
    const p = getPool()
    if (!p) throw new Error('DATABASE_URL belum diset — fitur database nonaktif')
    return p.query(text, params)
}

module.exports = { q, enabled, getPool }
