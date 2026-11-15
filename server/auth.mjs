// Logins for SECOND-SERVE: PINs hashed with scrypt, random session tokens
// stored only as SHA-256 hashes, sessions in an HttpOnly cookie.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1 }
export const SESSION_HOURS = 12
export const COOKIE = 'ss_sid'

export function hashPin(pin) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(pin), salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPin(pin, stored) {
  const [kind, saltB64, hashB64] = String(stored).split('$')
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(String(pin), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const validPin = (pin) => typeof pin === 'string' && /^\d{4,8}$/.test(pin)

export function newToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: tokenHash(token) }
}

export const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function sessionCookie(token, maxAgeSec) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`
}

/** Simple sliding-window limiter, in memory. */
export function limiter(max, windowMs) {
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 10_000) hits.clear()
    return recent.length > max
  }
}
