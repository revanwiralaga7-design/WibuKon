// Penyimpanan lokal WibuKon: Lanjutkan Nonton & Bookmark.
// Semua data disimpan di localStorage browser — tanpa backend/database.
window.WibuStore = (function () {
    var CONTINUE_KEY = 'wibukonContinue'
    var BOOKMARK_KEY = 'wibukonBookmarks'
    var MAX_CONTINUE = 12    // maks entri lanjutkan nonton
    var MAX_BOOKMARK = 100   // maks entri bookmark

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
    // Satu entri per anime: menonton episode baru menimpa episode lama.

    function getContinue() {
        return read(CONTINUE_KEY)
    }

    // item: { animeId, slug, title, img, epsId, epsSlug, epsTitle }
    function saveContinue(item) {
        if (!item || !item.animeId || !item.epsId || !item.slug || !item.epsSlug) return
        var list = read(CONTINUE_KEY).filter(function (x) {
            return String(x.animeId) !== String(item.animeId)
        })
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
        clearBookmarks: clearBookmarks
    }
})()
