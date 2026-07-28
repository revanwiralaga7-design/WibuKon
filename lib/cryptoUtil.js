const crypto = require('crypto')

// Hash password dengan scrypt + salt acak (bawaan Node, tanpa dependency)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
    return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || '').split(':')
    if (!salt || !hash) return false
    const candidate = crypto.scryptSync(String(password), salt, 64)
    const reference = Buffer.from(hash, 'hex')
    return candidate.length === reference.length && crypto.timingSafeEqual(candidate, reference)
}

function randomToken() {
    return crypto.randomBytes(32).toString('hex')
}

module.exports = { hashPassword, verifyPassword, randomToken }
