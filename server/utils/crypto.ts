const PBKDF2_ITERATIONS = 100_000
const SALT_BYTE_LENGTH = 16
const KEY_BIT_LENGTH = 256
const HASH_PREFIX = 'pbkdf2_sha256'

export const RECOVERY_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes
export const PASSWORD_HASH_TAIL_LENGTH = 8

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(base64Url: string): Uint8Array | null {
  try {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = (4 - (base64.length % 4)) % 4
    const padded = base64 + '='.repeat(padLength)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function verifySignedPayload(
  payloadB64: string,
  signatureB64: string,
  secret: string,
): Promise<boolean> {
  const signatureBytes = base64UrlToBytes(signatureB64)
  if (!signatureBytes || signatureBytes.length === 0) {
    return false
  }
  const encoder = new TextEncoder()
  const key = await importHmacKey(secret)
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes as BufferSource,
    encoder.encode(payloadB64),
  )
}

/**
 * Hashes a plaintext password using Web Crypto API PBKDF2-SHA256 (Cloudflare Workers compatible).
 */
export async function hashPassword(password: string, customSaltHex?: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = customSaltHex
    ? hexToBytes(customSaltHex)
    : crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BIT_LENGTH,
  )

  const hashHex = bytesToHex(new Uint8Array(derivedBits))
  const saltHex = bytesToHex(salt)

  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`
}

/**
 * Verifies a plaintext password against a stored PBKDF2-SHA256 hash using constant-time comparison.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) {
    return false
  }

  const iterations = Number.parseInt(parts[1]!, 10)
  const saltHex = parts[2]!
  const expectedHashHex = parts[3]!

  if (!Number.isFinite(iterations) || iterations <= 0 || !saltHex || !expectedHashHex) {
    return false
  }

  const encoder = new TextEncoder()
  const salt = hexToBytes(saltHex)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BIT_LENGTH,
  )

  const actualHashHex = bytesToHex(new Uint8Array(derivedBits))
  if (actualHashHex.length !== expectedHashHex.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < actualHashHex.length; i++) {
    diff |= actualHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Returns the last 8 characters of a user's `password_hash` as required by SPECIFICATION.md.
 */
export function getPasswordHashTail(passwordHash: string): string {
  return passwordHash.slice(-PASSWORD_HASH_TAIL_LENGTH)
}

export interface RecoveryTokenPayload {
  userId: string
  expiresAtMs: number
  passwordHashTail: string
}

interface RawRecoveryTokenClaims {
  typ: 'recovery'
  uid: string
  exp: number
  pht: string
}

/**
 * Generates a 30-minute stateless HMAC-SHA256 password recovery token encoding:
 * - `user_id` (`uid`)
 * - expiration timestamp (`exp = now + 30 minutes`)
 * - last 8 characters of the current `password_hash` (`pht`)
 */
export async function createRecoveryToken(
  params: {
    userId: string
    passwordHash: string
    nowMs?: number
  },
  secret: string,
): Promise<string> {
  const nowMs = params.nowMs ?? Date.now()
  const claims: RawRecoveryTokenClaims = {
    typ: 'recovery',
    uid: params.userId,
    exp: nowMs + RECOVERY_TOKEN_TTL_MS,
    pht: getPasswordHashTail(params.passwordHash),
  }
  const encoder = new TextEncoder()
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(claims)))
  const signatureB64 = await signPayload(payloadB64, secret)
  return `${payloadB64}.${signatureB64}`
}

/**
 * Verifies a 30-minute stateless HMAC-SHA256 password recovery token.
 * Returns the decoded claims if the signature is authentic and the token has not expired;
 * otherwise returns `null`.
 */
export async function verifyRecoveryToken(
  token: string,
  secret: string,
  nowMs?: number,
): Promise<RecoveryTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }
  const [payloadB64, signatureB64] = parts
  if (!payloadB64 || !signatureB64) {
    return null
  }

  const isValidSignature = await verifySignedPayload(payloadB64, signatureB64, secret)
  if (!isValidSignature) {
    return null
  }

  const payloadBytes = base64UrlToBytes(payloadB64)
  if (!payloadBytes) {
    return null
  }

  try {
    const decoder = new TextDecoder()
    const claims = JSON.parse(decoder.decode(payloadBytes)) as Partial<RawRecoveryTokenClaims>
    if (
      claims.typ !== 'recovery' ||
      typeof claims.uid !== 'string' ||
      claims.uid.trim().length === 0 ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      typeof claims.pht !== 'string' ||
      claims.pht.length !== PASSWORD_HASH_TAIL_LENGTH
    ) {
      return null
    }

    const currentMs = nowMs ?? Date.now()
    if (currentMs > claims.exp) {
      return null
    }

    return {
      userId: claims.uid,
      expiresAtMs: claims.exp,
      passwordHashTail: claims.pht,
    }
  } catch {
    return null
  }
}

export interface SessionTokenPayload {
  userId: string
  centerId: string
  issuedAtMs: number
}

interface RawSessionTokenClaims {
  typ: 'session'
  uid: string
  cid: string
  iat: number
}

/**
 * Creates a stateless HMAC-SHA256 session token containing `user_id` and active `center_id`.
 */
export async function createSessionToken(
  params: {
    userId: string
    centerId: string
    nowMs?: number
  },
  secret: string,
): Promise<string> {
  const claims: RawSessionTokenClaims = {
    typ: 'session',
    uid: params.userId,
    cid: params.centerId,
    iat: params.nowMs ?? Date.now(),
  }
  const encoder = new TextEncoder()
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(claims)))
  const signatureB64 = await signPayload(payloadB64, secret)
  return `${payloadB64}.${signatureB64}`
}

/**
 * Verifies a stateless HMAC-SHA256 session token and returns `userId` and `centerId`.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }
  const [payloadB64, signatureB64] = parts
  if (!payloadB64 || !signatureB64) {
    return null
  }

  const isValidSignature = await verifySignedPayload(payloadB64, signatureB64, secret)
  if (!isValidSignature) {
    return null
  }

  const payloadBytes = base64UrlToBytes(payloadB64)
  if (!payloadBytes) {
    return null
  }

  try {
    const decoder = new TextDecoder()
    const claims = JSON.parse(decoder.decode(payloadBytes)) as Partial<RawSessionTokenClaims>
    if (
      claims.typ !== 'session' ||
      typeof claims.uid !== 'string' ||
      claims.uid.trim().length === 0 ||
      typeof claims.cid !== 'string' ||
      claims.cid.trim().length === 0 ||
      typeof claims.iat !== 'number' ||
      !Number.isFinite(claims.iat)
    ) {
      return null
    }

    return {
      userId: claims.uid,
      centerId: claims.cid,
      issuedAtMs: claims.iat,
    }
  } catch {
    return null
  }
}

/**
 * Generates a cryptographically secure random password using Web Crypto API.
 */
export function generateRandomPassword(length = 12): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const randomBytes = crypto.getRandomValues(new Uint8Array(length))
  let password = ''
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i]! % charset.length]
  }
  return password
}
