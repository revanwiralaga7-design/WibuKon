// Penyimpanan lokal WibuKon: Lanjutkan Nonton & Bookmark.
// Semua data disimpan di localStorage browser — tanpa backend/database.
window.WibuStore = (function () {
    var CONTINUE_KEY = 'wibukonContinue'
    var BOOKMARK_KEY = 'wibukonBookmarks'
    var WATCHED_KEY = 'wibukonWatched'
    var MAX_CONTINUE = 12      // maks entri lanjutkan nonton
    var MAX_BOOKMARK = 100     // maks entri bookmark
    var MAX_WATCHED_ANIME = 100  // maks anime yang riwayat episodenya disimpan (LRU)
    var MAX_WATCHED_EPS = 1500   // maks episode per anime (anime sepanjang One Piece pun muat)

    function read(key) {
        try { return JSON.parse(localStorage.getItem(key)) || [] } catch (e) { return [] }
    }

    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
    }

    // Escape teks sebelum disisipkan ke HTML — judul dari API bisa mengandung karakter berbahaya
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        })
    }

    /* ================= Lanjutkan Nonton ================= */
    // Satu entri per anime: mencatat episode TERJAUH yang pernah dibuka,
    // jadi rewatch episode lama tidak menurunkan progres.

    // Ambil nomor episode dari slug ("10-episode-3" -> 3) atau judul ("Episode 3" -> 3)
    function epsNum(item) {
        var m = /-episode-(\d+)/.exec((item && item.epsSlug) || '')
        if (m) return parseInt(m[1], 10)
        var d = /\d+/.exec((item && item.epsTitle) || '')
        return d ? parseInt(d[0], 10) : 0
    }

    function getContinue() {
        return read(CONTINUE_KEY)
    }

    // item: { animeId, slug, title, img, epsId, epsSlug, epsTitle }
    function saveContinue(item) {
        if (!item || !item.animeId || !item.epsId || !item.slug || !item.epsSlug) return
        var list = read(CONTINUE_KEY)
        var idx = -1
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].animeId) === String(item.animeId)) { idx = i; break }
        }
        if (idx !== -1) {
            var prev = list[idx]
            var prevN = epsNum(prev)
            var newN = epsNum(item)
            list.splice(idx, 1)
            // Episode baru lebih KECIL (rewatch) & nomor keduanya valid:
            // jangan mundurkan progres — simpan yang terjauh, tapi tetap naik ke atas.
            if (newN > 0 && prevN > 0 && newN < prevN) {
                prev.updatedAt = Date.now()
                list.unshift(prev)
                write(CONTINUE_KEY, list.slice(0, MAX_CONTINUE))
                return
            }
        }
        item.updatedAt = Date.now()
        list.unshift(item)
        write(CONTINUE_KEY, list.slice(0, MAX_CONTINUE))
    }

    function removeContinue(animeId) {
        write(CONTINUE_KEY, read(CONTINUE_KEY).filter(function (x) {
            return String(x.animeId) !== String(animeId)
        }))
    }

    function clearContinue() {
        localStorage.removeItem(CONTINUE_KEY)
    }

    /* ================= Bookmark ================= */
    // item: { animeId, slug, title, img, rating, year, status }

    function getBookmarks() {
        return read(BOOKMARK_KEY)
    }

    function isBookmarked(animeId) {
        return read(BOOKMARK_KEY).some(function (x) {
            return String(x.animeId) === String(animeId)
        })
    }

    function addBookmark(item) {
        if (!item || !item.animeId || !item.slug) return false
        if (isBookmarked(item.animeId)) return true
        var list = read(BOOKMARK_KEY)
        item.addedAt = Date.now()
        list.unshift(item)
        write(BOOKMARK_KEY, list.slice(0, MAX_BOOKMARK))
        return true
    }

    function removeBookmark(animeId) {
        write(BOOKMARK_KEY, read(BOOKMARK_KEY).filter(function (x) {
            return String(x.animeId) !== String(animeId)
        }))
    }

    // return true jika setelah toggle jadi tersimpan, false jika jadi terhapus
    function toggleBookmark(item) {
        if (isBookmarked(item.animeId)) {
            removeBookmark(item.animeId)
            return false
        }
        addBookmark(item)
        return true
    }

    function clearBookmarks() {
        localStorage.removeItem(BOOKMARK_KEY)
    }

    /* ================= Episode Sudah Ditonton ================= */
    // Bentuk: { animeId: { e: [epsId...], t: timestampTerakhir } }
    // LRU per anime: anime yang paling lama tak disentuh dibuang duluan.

    function readWatchedObj() {
        try {
            var o = JSON.parse(localStorage.getItem(WATCHED_KEY))
            return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}
        } catch (e) { return {} }
    }

    function writeWatchedObj(o) {
        try { localStorage.setItem(WATCHED_KEY, JSON.stringify(o)) } catch (e) {}
    }

    function pruneWatched(o) {
        var keys = Object.keys(o)
        if (keys.length <= MAX_WATCHED_ANIME) return o
        keys.sort(function (a, b) { return (o[a].t || 0) - (o[b].t || 0) }) // tertua dulu
        for (var i = 0; i < keys.length - MAX_WATCHED_ANIME; i++) delete o[keys[i]]
        return o
    }

    // Tandai 1 episode sudah ditonton
    function markWatched(animeId, epsId) {
        animeId = String(animeId); epsId = String(epsId)
        if (!animeId || !epsId) return
        var o = readWatchedObj()
        var w = o[animeId] || { e: [], t: 0 }
        if (w.e.indexOf(epsId) === -1) w.e.push(epsId)
        if (w.e.length > MAX_WATCHED_EPS) w.e = w.e.slice(-MAX_WATCHED_EPS)
        w.t = Date.now()
        o[animeId] = w
        writeWatchedObj(pruneWatched(o))
    }

    // Gabungkan daftar dari server ke lokal (sinkron lintas perangkat).
    // Tidak mengubah timestamp LRU — merge bukan aktivitas nonton.
    function mergeWatched(animeId, epsIds) {
        if (!Array.isArray(epsIds) || !epsIds.length) return
        var o = readWatchedObj()
        var key = String(animeId)
        var w = o[key] || { e: [], t: 0 }
        var added = false
        epsIds.forEach(function (id) {
            id = String(id)
            if (w.e.indexOf(id) === -1) { w.e.push(id); added = true }
        })
        if (!added) return
        if (w.e.length > MAX_WATCHED_EPS) w.e = w.e.slice(-MAX_WATCHED_EPS)
        o[key] = w
        writeWatchedObj(pruneWatched(o))
    }

    function getWatched(animeId) {
        var w = readWatchedObj()[String(animeId)]
        return w ? w.e.slice() : []
    }

    function isWatched(animeId, epsId) {
        var w = readWatchedObj()[String(animeId)]
        return w ? w.e.indexOf(String(epsId)) !== -1 : false
    }

    // Ambil daftar "sudah ditonton" dari server (khusus user login), merge ke
    // lokal, lalu panggil cb(daftarEps). Anon/gagal → fallback daftar lokal.
    function syncWatched(animeId, cb) {
        var local = getWatched(animeId)
        if (!window.fetch) { if (cb) cb(local); return }
        fetch('/api/watched/' + encodeURIComponent(String(animeId)))
            .then(function (r) { return r.json() })
            .then(function (d) {
                if (d && d.ok && Array.isArray(d.eps)) {
                    mergeWatched(animeId, d.eps)
                    if (cb) cb(getWatched(animeId))
                } else if (cb) cb(local)
            })
            .catch(function () { if (cb) cb(local) })
    }

    // Kirim tanda "sudah ditonton" ke server (best-effort: anon/gagal diamkan,
    // lokal sudah dicatat lebih dulu oleh markWatched).
    function pushWatched(animeId, epsId) {
        if (!window.fetch) return
        try {
            fetch('/api/watched', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ animeId: String(animeId), epsId: String(epsId) })
            }).catch(function () {})
        } catch (e) {}
    }

    return {
        esc: esc,
        getContinue: getContinue,
        saveContinue: saveContinue,
        removeContinue: removeContinue,
        clearContinue: clearContinue,
        getBookmarks: getBookmarks,
        isBookmarked: isBookmarked,
        addBookmark: addBookmark,
        removeBookmark: removeBookmark,
        toggleBookmark: toggleBookmark,
        clearBookmarks: clearBookmarks,
        markWatched: markWatched,
        mergeWatched: mergeWatched,
        getWatched: getWatched,
        isWatched: isWatched,
        syncWatched: syncWatched,
        pushWatched: pushWatched
    }
})()
