// Sistem Level & EXP WibuKon — v2.
// Dua mode:
//   - MODE SERVER  : user login -> EXP disimpan di PostgreSQL (anti-cheat di server),
//                    sinkron di semua perangkat. Konfigurasi rank/event dari admin panel.
//   - MODE LOKAL   : anonim     -> EXP di localStorage (bisa diakali, per-device) seperti v1.
// Konfigurasi rank/event lokal hanya DEFAULT — selalu ditimpa milik server jika tersedia.
window.WibuLevel = (function () {
    var STATE_KEY = 'wibukonLevel'

    var RANKS = [
        { min: 1,    name: 'Newbie',      icon: '\u{1F331}', color: '#a1a1aa' },
        { min: 10,   name: 'Bronze',      icon: '\u{1F949}', color: '#b45309' },
        { min: 25,   name: 'Silver',      icon: '\u{1F948}', color: '#9ca3af' },
        { min: 50,   name: 'Gold',        icon: '\u{1F947}', color: '#eab308' },
        { min: 100,  name: 'Platinum',    icon: '\u{1F4A0}', color: '#22d3ee' },
        { min: 200,  name: 'Diamond',     icon: '\u{1F48E}', color: '#60a5fa' },
        { min: 350,  name: 'Master',      icon: '\u{1F525}', color: '#f97316' },
        { min: 550,  name: 'Grandmaster', icon: '⚡',       color: '#a855f7' },
        { min: 800,  name: 'Legend',      icon: '\u{1F451}', color: '#f43f5e' },
        { min: 1000, name: 'Mythic',      icon: '\u{1F30C}', color: '#c084fc' }
    ]

    var EVENTS = {
        daily_visit: { xp: 50, cap: 1,  label: 'Kunjungan harian' },
        watch:       { xp: 20, cap: 15, label: 'Nonton episode' },
        bookmark:    { xp: 10, cap: 5,  label: 'Tambah bookmark' },
        search:      { xp: 5,  cap: 10, label: 'Mencari anime' }
    }

    var MODE = 'local'          // 'local' | 'server'
    var ready = false
    var queue = []              // grant yang datang sebelum init selesai
    var listeners = []
    var serverUser = null
    var serverState = null
    var serverHistory = []

    /* ================= Matematika level (bentuk kanonik) ================= */

    function maxLevel() { return RANKS[RANKS.length - 1].min }

    function rankIndexForLevel(level) {
        var idx = 0
        for (var i = 0; i < RANKS.length; i++) if (level >= RANKS[i].min) idx = i
        return idx
    }

    function xpForLevel(n) {
        return (rankIndexForLevel(Math.min(Math.max(n, 1), maxLevel())) + 1) * 100
    }

    function levelFromXp(xp) {
        var level = 1
        var remain = Math.max(0, Math.floor(xp))
        while (level < maxLevel()) {
            var need = xpForLevel(level)
            if (remain < need) return { level: level, into: remain, need: need }
            remain -= need
            level++
        }
        return { level: maxLevel(), into: 0, need: 0 }
    }

    // Bentuk state yang dipakai UI (mode lokal & server disamakan di sini)
    function canon(rankEntry, li, xp) {
        return {
            xp: xp,
            level: li.level,
            rank: rankEntry.name,
            rankIcon: rankEntry.icon,
            rankColor: rankEntry.color,
            into: li.into,
            need: li.need,
            progress: li.need ? Math.min(100, Math.round((li.into / li.need) * 100)) : 100,
            isMax: li.level >= maxLevel()
        }
    }

    /* ================= Mode lokal (localStorage) ================= */

    function today() { return new Date().toISOString().slice(0, 10) }
    function defaultState() { return { xp: 0, day: today(), counters: {}, uniq: [], history: [] } }

    function load() {
        var s
        try { s = JSON.parse(localStorage.getItem(STATE_KEY)) } catch (e) { s = null }
        if (!s || typeof s.xp !== 'number') s = defaultState()
        if (s.day !== today()) { s.day = today(); s.counters = {}; s.uniq = []; save(s) }
        return s
    }
    function save(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch (e) {} }

    function localState() {
        var s = load()
        return canon(RANKS[rankIndexForLevel(levelFromXp(s.xp).level)], levelFromXp(s.xp), s.xp)
    }

    function localGrant(eventName, uniqKey) {
        var ev = EVENTS[eventName]
        if (!ev) return null
        var s = load()
        var used = s.counters[eventName] || 0
        if (used >= ev.cap) return null
        if (uniqKey) {
            var k = eventName + ':' + uniqKey
            if (s.uniq.indexOf(k) !== -1) return null
            s.uniq.push(k)
        }
        var before = levelFromXp(s.xp).level
        s.counters[eventName] = used + 1
        s.xp += ev.xp
        s.history.unshift({ t: Date.now(), amt: ev.xp, label: ev.label })
        s.history = s.history.slice(0, 20)
        save(s)
        var after = levelFromXp(s.xp).level
        toast('+' + ev.xp + ' EXP &middot; ' + ev.label, '#8b5cf6')
        if (after > before) {
            var r = RANKS[rankIndexForLevel(after)]
            toast('\u{1F389} ' + (r.min === after ? 'RANK BARU: ' + r.icon + ' ' + r.name + '!' : 'Naik ke Level ' + after + '!'), r.color)
        }
        notify()
        return ev.xp
    }

    /* ================= Mode server ================= */

    function serverGrant(eventName, uniqKey) {
        fetch('/api/exp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: eventName, uniq: uniqKey || null })
        }).then(function (r) { return r.json() }).then(function (d) {
            if (!d || !d.ok) {
                // Sesi kedaluwarsa di tengah jalan -> lanjut lokal saja
                if (d && d.reason === 'not_logged_in') { MODE = 'local'; localGrant(eventName, uniqKey) }
                return
            }
            var st = d.state
            serverState = canon(st.rank, { level: st.level, into: st.into, need: st.need }, st.xp)
            serverHistory.unshift({ t: Date.now(), amt: d.amount, label: d.label })
            serverHistory = serverHistory.slice(0, 20)
            toast('+' + d.amount + ' EXP &middot; ' + d.label, '#8b5cf6')
            if (d.leveledUp) {
                var r = st.rank
                toast('\u{1F389} ' + (d.rankUp ? 'RANK BARU: ' + r.icon + ' ' + r.name + '!' : 'Naik ke Level ' + st.level + '!'), r.color)
            }
            notify()
        }).catch(function () { /* jaringan putus: diamkan, tidak dobel */ })
    }

    /* ================= Toast ================= */

    var toastWrap = null
    function ensureToastWrap() {
        if (toastWrap && document.body.contains(toastWrap)) return toastWrap
        toastWrap = document.createElement('div')
        toastWrap.style.cssText = 'position:fixed;right:14px;bottom:88px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:78vw'
        document.body.appendChild(toastWrap)
        return toastWrap
    }
    function toast(html, color) {
        if (typeof document === 'undefined' || !document.body) return
        var el = document.createElement('div')
        el.style.cssText = 'background:#18181b;border:1px solid ' + (color || '#8b5cf6') + ';color:#fff;padding:8px 14px;border-radius:12px;font-size:12px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:all .25s ease;text-align:right'
        el.innerHTML = html
        ensureToastWrap().appendChild(el)
        requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)' })
        setTimeout(function () {
            el.style.opacity = '0'; el.style.transform = 'translateY(8px)'
            setTimeout(function () { el.remove() }, 300)
        }, 2400)
    }

    /* ================= API publik ================= */

    function notify() {
        listeners.forEach(function (cb) { try { cb() } catch (e) {} })
    }

    function grant(eventName, uniqKey) {
        if (!ready) { queue.push([eventName, uniqKey]); return } // tunggu init
        if (MODE === 'server') serverGrant(eventName, uniqKey)
        else localGrant(eventName, uniqKey)
    }

    function getState() {
        return (MODE === 'server' && serverState) ? serverState : localState()
    }

    function getUser() { return MODE === 'server' ? serverUser : null }

    function getHistory() {
        if (MODE === 'server') return serverHistory
        return load().history
    }

    function getRanks() {
        return RANKS.map(function (r, i) {
            return {
                name: r.name, icon: r.icon, color: r.color, min: r.min,
                max: (i + 1 < RANKS.length) ? RANKS[i + 1].min - 1 : maxLevel(),
                xpPerLevel: (i + 1) * 100
            }
        })
    }

    function getEvents() {
        return Object.keys(EVENTS).map(function (k) {
            return { key: k, xp: EVENTS[k].xp, cap: EVENTS[k].cap, label: EVENTS[k].label }
        })
    }

    function reset() {
        try { localStorage.removeItem(STATE_KEY) } catch (e) {}
        notify()
    }

    function onChange(cb) { listeners.push(cb) }

    function applyConfig(cfg) {
        if (cfg && Array.isArray(cfg.ranks) && cfg.ranks.length >= 2) RANKS = cfg.ranks
        if (cfg && cfg.events && typeof cfg.events === 'object' && !Array.isArray(cfg.events)) EVENTS = cfg.events
    }

    /* ================= Init: deteksi login & konfigurasi server ================= */

    function finish() {
        ready = true
        queue.splice(0).forEach(function (a) { grant(a[0], a[1]) })
        notify()
    }

    function boot() {
        if (!window.fetch) { finish(); return }
        fetch('/api/level/state')
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
            .then(function (d) {
                applyConfig(d && d.config)
                if (d && d.user && d.state) {
                    MODE = 'server'
                    serverUser = d.user
                    // Kapasitas penyimpanan lokal jumbo untuk VIP (benefit)
                    if (window.WibuStore && WibuStore.setVip) WibuStore.setVip(!!d.user.vip)
                    var st = d.state
                    serverState = canon(st.rank, { level: st.level, into: st.into, need: st.need }, st.xp)
                    serverHistory = (Array.isArray(d.history) ? d.history : []).map(function (h) {
                        return { t: h.created_at ? new Date(h.created_at).getTime() : Date.now(), amt: h.amount, label: h.label || h.event_key }
                    })
                }
            })
            .catch(function () { /* server tak merespon -> tetap lokal */ })
            .finally(finish)
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
        else boot()
    } else {
        finish()
    }

    return {
        grant: grant,
        getState: getState,
        getUser: getUser,
        getMode: function () { return MODE },
        getHistory: getHistory,
        getRanks: getRanks,
        getEvents: getEvents,
        reset: reset,
        onChange: onChange,
        xpForLevel: xpForLevel,
        levelFromXp: levelFromXp
    }
})()
