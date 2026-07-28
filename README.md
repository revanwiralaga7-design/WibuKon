# Dokumentasi Project WibuKon

WibuKon adalah platform web streaming anime modern yang dibangun menggunakan Node.js, Express, dan EJS untuk server-side rendering, dengan Tailwind CSS via CDN.

## Fitur

- Beranda: hero carousel ongoing, episode terbaru, rekomendasi
- Lanjutkan Nonton: otomatis tercatat episode **terjauh** yang pernah dibuka per anime — rewatch episode lama tidak menurunkan progres (localStorage `wibukonContinue`, maks 12)
- **Tanda episode sudah ditonton** (✓): setiap tile di halaman detail & daftar episode halaman nonton ditandai otomatis + progres "n/total ditonton". Disimpan lokal (localStorage `wibukonWatched`, LRU 100 anime × 1.500 episode) dan **disinkronkan ke PostgreSQL per akun** saat login (`/api/watched`) — nyambung lintas perangkat
- Bookmark anime dari halaman detail, dikelola di `/bookmarks` (localStorage `wibukonBookmarks`)
- Pencarian: riwayat pencarian (localStorage) + tombol "Muat Lebih" (pagination API `startpage`/`perpage`, mode JSON `?page=N&json=1`)
- Jadwal rilis per hari
- Sistem Level & EXP (`/level`): 10 rank dari Newbie (Lv.1) sampai Mythic (Lv.1000). Tamu: localStorage. **Login: EXP disimpan di PostgreSQL** (anti-cheat server-side, sinkron antar perangkat)
- **Leaderboard** (`/leaderboard`): peringkat EXP harian / 7 hari / 30 hari / semua waktu, medali top 3, sorotan posisi sendiri (EXP dari penyesuaian admin tidak dihitung)
- **Komentar per episode** di halaman nonton: login untuk menulis (maks 500 karakter, jeda 15 detik), tamu tetap bisa membaca. User bisa hapus komentarnya sendiri; **staff (role admin/owner) bisa menghapus komentar siapa pun** + punya badge 👑/🛡
- **Panel Admin** (`/admin`) dengan 2 role — owner & admin: dashboard statistik, manajemen user (adjust EXP, ban, **ubah role publik**), kontrol konten (pengumuman, anime unggulan, blacklist), konfigurasi rank/event, kelola akun admin
- Login Google (OAuth 2.0) — auto buat/tautkan akun via `google_id`, avatar tampil di navbar & komentar
- Cache in-memory (`lib/cache.js`): home 5 menit, search 10 menit, detail 30 menit
- Fallback gambar otomatis jika cover gagal dimuat

---

## Struktur Direktori

```text
Wibukon/
├── lib/
│   ├── ServerData.js        # Provider API data anime (Mobinime)
│   └── cache.js             # Cache in-memory dengan TTL
├── public/
│   ├── js/
│   │   └── app.js           # WibuStore: lanjutkan nonton & bookmark (localStorage)
│   ├── images/
│   │   └── placeholder.svg  # Fallback jika cover gagal dimuat
│   ├── wibukon-banner.jpg
│   └── wibukon.jpg
├── routes/
│   ├── index.js             # Aggregator semua route
│   ├── home.js              # GET /
│   ├── schedule.js          # GET /schedule
│   ├── search.js            # GET /search
│   ├── about.js             # GET /about
│   ├── bookmarks.js         # GET /bookmarks
│   ├── anime.js             # GET /anime/:slug
│   └── watch.js             # GET /watch/:animeSlug/:epsSlug
├── views/
│   ├── layout/
│   │   ├── head.ejs
│   │   └── navbar.ejs
│   ├── 404.ejs
│   ├── about.ejs
│   ├── bookmarks.ejs
│   ├── detail.ejs
│   ├── error.ejs
│   ├── index.ejs
│   ├── schedule.ejs
│   ├── search.ejs
│   └── watch.ejs
├── .env.example
├── index.js                 # Entry point server
└── package.json
```

---

## Arsitektur

### Server Core (index.js)
Entry point yang menginisialisasi Express, mengatur middleware, dan memanggil setupRoutes untuk mendaftarkan semua route.

### Routes (routes/)
Setiap route dipisahkan ke file sendiri dan menerima instance mobinime sebagai dependency injection:
- home.js: Menampilkan beranda dengan data ongoing dan rekomendasi.
- schedule.js: Menampilkan jadwal rilis harian.
- search.js: Menampilkan hasil pencarian berdasarkan query.
- about.js: Halaman tentang.
- anime.js: Halaman detail anime.
- watch.js: Halaman streaming episode.

### Data Provider (lib/ServerData.js)
Kelas Mobinime yang mengelola request ke API eksternal:
- fetchHomeData(): Data beranda (rekomendasi, ongoing, jadwal).
- search(query): Pencarian anime.
- detail(id): Detail anime dan daftar episode.
- stream(id, epsid): URL video streaming.

### Views (views/)
Template EJS dengan Tailwind CSS untuk dark mode UI. Layout partial: head.ejs (meta, styles) dan navbar.ejs (navigasi).

---

## Menjalankan

```bash
npm install
npm start
```

Buka http://localhost:3000

### Environment Variables (.env)

```env
PORT=3000

# PostgreSQL — kosongkan untuk mode tanpa DB (fitur akun/admin nonaktif)
DATABASE_URL=postgres://user:password@host:5432/wibukon

# Akun owner pertama (dibuat otomatis saat migrasi pertama)
OWNER_USERNAME=owner
OWNER_PASSWORD=ganti-password-ini

# Login Google (OAuth client dari Google Cloud Console)
# Redirect URI yang didaftarkan: https://domainmu.com/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Login Google

1. Buka [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. **Create Credentials → OAuth client ID** → tipe **Web application**
3. Tambahkan **Authorized redirect URI**: `https://domainmu.com/auth/google/callback` (untuk lokal: `http://localhost:3000/auth/google/callback`)
4. Salin Client ID & Secret ke `.env`, restart server — tombol "Masuk dengan Google" otomatis muncul di `/login` & `/register`

Cara kerja: user diautentikasi Google → akun dibuat/ditautkan via `google_id` → sesi login biasa. User Google tidak punya password (tetap bisa menambah EXP, di-manage admin seperti user lain).

### Panel Admin

- URL: `/admin/login` — kredensial owner dari `OWNER_USERNAME`/`OWNER_PASSWORD`
- **owner**: akses penuh (dashboard, user, konten, konfigurasi rank, kelola admin)
- **admin**: dashboard, manajemen user, kontrol konten (tanpa halaman Rank & Admin)
- Migrasi tabel jalan otomatis saat boot (idempoten)

Role hak akses:

| Fitur | Admin | Owner |
|---|---|---|
| Dashboard | ✅ | ✅ |
| Manajemen user (EXP, ban) | ✅ | ✅ |
| Ubah role publik user (user/admin/owner — badge & command komentar) | ❌ | ✅ |
| Kontrol konten | ✅ | ✅ |
| Konfigurasi rank & event | ❌ | ✅ |
| Kelola akun admin | ❌ | ✅ |

> Catatan: ada dua konsep role. **Role panel** (`admins` table) = akses ke `/admin`. **Role publik** (`users.role`) = badge 🛡/👑 di komentar & leaderboard + bisa menghapus komentar siapa pun. Owner panel mengatur role publik dari halaman detail user.
