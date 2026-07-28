// Logika pemberian EXP sisi server — sumber kebenaran untuk user yang login.
// Anti-cheat di sini (bukan di browser): cap harian & episode unik dihitung
// dari tabel xp_events, sehingga tidak bisa diakali lewat DevTools.
const store = require('./store')
const levels = require('./levels')
const settingsCache = require('./settingsCache')

// return { ok, reason?, amount?, before?, after?, leveledUp?, rankUp? }
async function grant(user, eventKey, uniqKey) {
    const cfg = await settingsCache.getAll()
    const ev = (cfg.events || {})[eventKey]
    if (!ev) return { ok: false, reason: 'unknown_event' }
    if (user.is_banned) return { ok: false, reason: 'banned' }

    const used = await store.countEventToday(user.id, eventKey)
    if (used >= ev.cap) return { ok: false, reason: 'cap', cap: ev.cap }

    const uniq = uniqKey ? String(uniqKey).slice(0, 100) : null
    if (uniq && await store.existsUniqToday(user.id, eventKey, uniq)) {
        return { ok: false, reason: 'duplicate' }
    }

    const before = levels.stateFor(cfg.ranks, user.xp)
    const newXp = await store.addXp(user.id, ev.xp)
    if (newXp === null) return { ok: false, reason: 'user_not_found' }
    await store.addXpEvent(user.id, eventKey, ev.xp, ev.label, uniq)
    await store.touchUser(user.id)

    const after = levels.stateFor(cfg.ranks, newXp)
    return {
        ok: true,
        amount: ev.xp,
        label: ev.label,
        state: after,
        leveledUp: after.level > before.level,
        rankUp: after.level > before.level && after.rank.name !== before.rank.name
    }
}

// Penyesuaian manual oleh admin (boleh negatif, tanpa cap harian)
async function adminAdjust(admin, user, delta, reason) {
    const before = levels.stateFor((await settingsCache.getAll()).ranks, user.xp)
    const newXp = await store.addXp(user.id, delta)
    if (newXp === null) return { ok: false, reason: 'user_not_found' }
    const label = (reason || 'Penyesuaian admin').slice(0, 100) + ` (oleh ${admin.username})`
    await store.addXpEvent(user.id, 'admin_adjust', delta, label, null)
    const cfg = await settingsCache.getAll()
    return { ok: true, before, after: levels.stateFor(cfg.ranks, newXp) }
}

module.exports = { grant, adminAdjust }
