const axios = require('axios')
const https = require('https')
const cache = require('./cache')
const settingsCache = require('./settingsCache')

const TTL = {
    HOME: 5 * 60 * 1000,      // beranda: 5 menit
    SEARCH: 10 * 60 * 1000,   // hasil pencarian: 10 menit
    DETAIL: 30 * 60 * 1000    // detail anime: 30 menit
    // stream URL sengaja TIDAK di-cache: bisa kedaluwarsa di sisi server video
}

class Mobinime {
    constructor() {
        this.inst = axios.create({
            baseURL: 'https://air.vunime.my.id/mobinime',
            timeout: 15000,
            httpsAgent: new https.Agent({ keepAlive: true }),
            headers: {
                'accept-encoding': 'gzip',
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
                'user-agent': 'Dart/3.3 (dart:io)',
                'x-api-key': 'ThWmZq4t7w!z%C*F-JaNdRgUkXn2r5u8'
            }
        })
    }

    normalizeAnimeData(item) {
        const cleanTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
        return {
            id: String(item.id),
            slug: `${item.id}-${cleanTitle}`,
            title: item.title,
            img: item.image_cover || item.imageCover || item.image_video || '',
            eps: item.episode || item.total_episode || '?',
            rating: item.rating || '-',
            year: item.tahun || '',
            status: item.status_tayang === '1' ? 'Ongoing' : 'Completed'
        }
    }

    // Bersihkan HTML sinopsis dari API: buang tag/atribut berbahaya (XSS),
    // tapi pertahankan entity (&ldquo; dsb) dan formatting dasar.
    sanitizeHtml(html) {
        return String(html || '')
            .replace(/<\s*(script|iframe|object|embed|form|svg|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
            .replace(/<\s*\/?\s*(script|iframe|object|embed|form|svg|link|meta)\b[^>]*>/gi, '')
            .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
            .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
            .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
            .replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"')
    }

    fetchHomeData = async function () {
        const cached = cache.get('home')
        if (cached) return cached

        try {
            const { data } = await this.inst.get('/pages/homepage')
            const bl = await settingsCache.getBlacklistSet()
            const visible = item => !bl.has(String(item.id))

            const result = {
                recommend: data.recommend.map(this.normalizeAnimeData).filter(visible),
                ongoing: data.ongoing.map(this.normalizeAnimeData).filter(visible),
                schedule: []
            }

            if (data.schedule) {
                const dayName = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
                Object.keys(data.schedule).forEach(day => {
                    result.schedule.push({
                        day: dayName[parseInt(day) - 1] || 'Lainnya',
                        list: data.schedule[day].map(this.normalizeAnimeData).filter(visible)
                    })
                })
            }

            cache.set('home', result, TTL.HOME)
            return result
        } catch (error) {
            throw new Error(error.message)
        }
    }

    search = async function (query, { page = '0', count = '25' } = {}) {
        const key = `search:${String(query).toLowerCase()}:${page}:${count}`
        const cached = cache.get(key)
        if (cached) return cached

        try {
            const { data } = await this.inst.post('/anime/search', {
                perpage: count.toString(),
                startpage: page.toString(),
                q: query
            })
            const bl = await settingsCache.getBlacklistSet()
            const result = data.map(this.normalizeAnimeData).filter(item => !bl.has(String(item.id)))
            cache.set(key, result, TTL.SEARCH)
            return result
        } catch (error) {
            return []
        }
    }

    detail = async function (id) {
        const key = `detail:${id}`
        const cached = cache.get(key)
        if (cached) return cached

        try {
            const { data } = await this.inst.post('/anime/detail', { id: id.toString() })

            const cleanTitle = (data.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')

            const result = {
                id: String(data.id),
                slug: `${data.id}-${cleanTitle}`,
                title: data.title,
                img: data.image_cover || data.image_video,
                desc: this.sanitizeHtml(data.content),
                rating: data.rating,
                year: data.tahun,
                status: data.status_tayang === '1' ? 'Ongoing' : 'Completed',
                genres: data.categories || [],
                episodes: data.episodes ? data.episodes.map(e => ({
                    id: String(e.id),
                    slug: `${e.id}-episode-${e.episode}`,
                    title: `Episode ${e.episode}`
                })) : []
            }

            cache.set(key, result, TTL.DETAIL)
            return result
        } catch (error) {
            throw new Error(error.message)
        }
    }

    stream = async function (id, epsid, { quality = 'HD' } = {}) {
        try {
            const { data: srv } = await this.inst.post('/anime/get-server-list', {
                id: epsid.toString(),
                animeId: id.toString(),
                jenisAnime: '1',
                userId: ''
            })

            const { data } = await this.inst.post('/anime/get-url-video', {
                url: srv.serverurl,
                quality: quality,
                position: '0'
            })

            if (!data?.url) throw new Error('Stream url unavailable')
            return data.url
        } catch (error) {
            throw new Error(error.message)
        }
    }
}

module.exports = Mobinime
