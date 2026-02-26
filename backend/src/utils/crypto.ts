import crypto from 'crypto'

/**
 * Crypto utilities for password hashing and data encryption
 *
 * Security approach:
 * 1. Password is hashed using PBKDF2 with SHA-256 and stored in database
 * 2. Password is used to derive an encryption key using PBKDF2
 * 3. Sensitive data is encrypted using AES-256-GCM
 * 4. Each encrypted value has its own IV (initialization vector)
 */

// Constants
const PBKDF2_ITERATIONS = 100000 // Recommended minimum for PBKDF2
const HASH_LENGTH = 64 // 512 bits
const SALT_LENGTH = 32 // 256 bits
const KEY_LENGTH = 32 // 256 bits for AES-256
const IV_LENGTH = 16 // 128 bits for AES-GCM

/**
 * Generate a random salt
 */
export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('hex')
}

/**
 * Hash a password using PBKDF2
 * Returns: { hash: string, salt: string }
 */
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const passwordSalt = salt || generateSalt()

  const hash = crypto.pbkdf2Sync(
    password,
    passwordSalt,
    PBKDF2_ITERATIONS,
    HASH_LENGTH,
    'sha256'
  ).toString('hex')

  return {
    hash,
    salt: passwordSalt
  }
}

/**
 * Verify a password against a stored hash
 */
export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt)
  return hash === storedHash
}

/**
 * Derive an encryption key from a password
 * Uses a separate salt for key derivation
 */
export function deriveKey(password: string, keySalt: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    keySalt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  )
}

/**
 * Encrypt data using AES-256-GCM
 * Returns: { encrypted: string, iv: string, authTag: string }
 */
export function encrypt(data: string, key: Buffer): { encrypted: string; iv: string; authTag: string } {
  // Generate a random IV for this encryption
  const iv = crypto.randomBytes(IV_LENGTH)

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  // Encrypt data
  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  // Get authentication tag
  const authTag = cipher.getAuthTag()

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  }
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encrypted: string, key: Buffer, iv: string, authTag: string): string {
  try {
    // Create decipher
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    )

    // Set authentication tag
    decipher.setAuthTag(Buffer.from(authTag, 'hex'))

    // Decrypt data
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    throw new Error('Decryption failed - invalid key or corrupted data')
  }
}

/**
 * Encrypt an object (converts to JSON first)
 */
export function encryptObject(obj: any, key: Buffer): { encrypted: string; iv: string; authTag: string } {
  const json = JSON.stringify(obj)
  return encrypt(json, key)
}

/**
 * Decrypt to an object (parses JSON)
 */
export function decryptObject(encrypted: string, key: Buffer, iv: string, authTag: string): any {
  const json = decrypt(encrypted, key, iv, authTag)
  return JSON.parse(json)
}

/**
 * Generate a complete encryption package for storing in database
 * Includes encrypted data, IV, and auth tag in a single string
 */
export function encryptForStorage(data: string, key: Buffer): string {
  const { encrypted, iv, authTag } = encrypt(data, key)
  // Format: iv:authTag:encrypted
  return `${iv}:${authTag}:${encrypted}`
}

/**
 * Decrypt data from storage format
 */
export function decryptFromStorage(data: string, key: Buffer): string {
  const parts = data.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format')
  }

  const [iv, authTag, encrypted] = parts
  return decrypt(encrypted, key, iv, authTag)
}

/**
 * Validate password strength
 * Returns: { valid: boolean, errors: string[] }
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
