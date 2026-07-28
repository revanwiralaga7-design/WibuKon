// Matematika level dari konfigurasi rank (sumber kebenaran sisi server).
// Rumus: EXP naik 1 level = 100 x (nomor rank). Level maks = min rank terakhir.
function maxLevel(ranks) {
    return ranks[ranks.length - 1].min
}

function rankIndex(ranks, level) {
    let idx = 0
    for (let i = 0; i < ranks.length; i++) {
        if (level >= ranks[i].min) idx = i
    }
    return idx
}

function xpForLevel(ranks, n) {
    const capped = Math.min(Math.max(1, n), maxLevel(ranks))
    return (rankIndex(ranks, capped) + 1) * 100
}

function levelFromXp(ranks, xp) {
    let level = 1
    let remain = Math.max(0, Math.floor(xp))
    const max = maxLevel(ranks)
    while (level < max) {
        const need = xpForLevel(ranks, level)
        if (remain < need) return { level, into: remain, need }
        remain -= need
        level++
    }
    return { level: max, into: 0, need: 0 }
}

function stateFor(ranks, xp) {
    const li = levelFromXp(ranks, xp)
    const r = ranks[rankIndex(ranks, li.level)]
    return {
        xp,
        level: li.level,
        rank: { name: r.name, icon: r.icon, color: r.color },
        into: li.into,
        need: li.need,
        progress: li.need ? Math.min(100, Math.round((li.into / li.need) * 100)) : 100,
        isMax: li.level >= maxLevel(ranks)
    }
}

// Validasi konfigurasi rank & event dari form admin
function validateRanks(input) {
    if (!Array.isArray(input) || input.length < 2 || input.length > 30) throw new Error('Ranks harus array 2-30 item')
    let prev = 0
    input.forEach((r, i) => {
        if (!Number.isInteger(r.min) || r.min <= prev) throw new Error(`Ranks[${i}].min harus integer menaik (setelah ${prev})`)
        if (i === 0 && r.min !== 1) throw new Error('Rank pertama harus mulai dari level 1')
        if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 20) throw new Error(`Ranks[${i}].name tidak valid`)
        if (typeof r.icon !== 'string' || !r.icon || [...r.icon].length > 4) throw new Error(`Ranks[${i}].icon tidak valid`)
        if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) throw new Error(`Ranks[${i}].color harus hex (#rrggbb)`)
        prev = r.min
        r.name = r.name.trim()
    })
    return input
}

function validateEvents(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Events harus berupa object')
    const keys = Object.keys(input)
    if (!keys.length || keys.length > 20) throw new Error('Events maksimal 20 jenis')
    for (const k of keys) {
        if (!/^[a-z0-9_]{2,30}$/.test(k)) throw new Error(`Key event "${k}" tidak valid (huruf kecil/angka/underscore)`)
        const ev = input[k]
        if (!Number.isFinite(ev.xp) || ev.xp < 0 || ev.xp > 100000) throw new Error(`events.${k}.xp harus 0-100000`)
        if (!Number.isInteger(ev.cap) || ev.cap < 1 || ev.cap > 100000) throw new Error(`events.${k}.cap harus integer >= 1`)
        ev.xp = Math.round(ev.xp)
        ev.label = String(ev.label || k).slice(0, 60)
    }
    return input
}

module.exports = { maxLevel, rankIndex, xpForLevel, levelFromXp, stateFor, validateRanks, validateEvents }
