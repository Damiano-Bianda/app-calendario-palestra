const PBKDF2_ITERATIONS = 100_000
const SALT_BYTE_LENGTH = 16
const KEY_BIT_LENGTH = 256
const HASH_PREFIX = 'pbkdf2_sha256'

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

