// Konfigurasi default (dipakai saat DB belum ada / seed awal).
// Admin (role owner) bisa mengubah rank & event EXP lewat /admin/ranks,
// hasilnya menimpa default ini di tabel settings.
const RANKS = [
    { min: 1,    name: 'Newbie',      icon: '🌱', color: '#a1a1aa' },
    { min: 10,   name: 'Bronze',      icon: '🥉', color: '#b45309' },
    { min: 25,   name: 'Silver',      icon: '🥈', color: '#9ca3af' },
    { min: 50,   name: 'Gold',        icon: '🥇', color: '#eab308' },
    { min: 100,  name: 'Platinum',    icon: '💠', color: '#22d3ee' },
    { min: 200,  name: 'Diamond',     icon: '💎', color: '#60a5fa' },
    { min: 350,  name: 'Master',      icon: '🔥', color: '#f97316' },
    { min: 550,  name: 'Grandmaster', icon: '⚡', color: '#a855f7' },
    { min: 800,  name: 'Legend',      icon: '👑', color: '#f43f5e' },
    { min: 1000, name: 'Mythic',      icon: '🌌', color: '#c084fc' }
]

const EVENTS = {
    daily_visit: { xp: 50, cap: 1,  label: 'Kunjungan harian' },
    watch:       { xp: 20, cap: 15, label: 'Nonton episode' },
    bookmark:    { xp: 10, cap: 5,  label: 'Tambah bookmark' },
    search:      { xp: 5,  cap: 10, label: 'Mencari anime' }
}

function defaultSettings() {
    return {
        ranks: RANKS,
        events: EVENTS,
        announcement: { active: false, text: '' },
        featured: [],   // daftar ID anime (dari API) pilihan admin
        blacklist: [],  // daftar ID anime yang disembunyikan dari situs
        // Info donasi yang tampil di halaman /vip (diedit dari /admin/content)
        vipInfo: 'Donasi lewat Trakteer/Saweria (tanya owner untuk link-nya), lalu kirim bukti lewat form di bawah. VIP diaktifkan manual oleh admin (±1x24 jam).'
    }
}

module.exports = { RANKS, EVENTS, defaultSettings }
