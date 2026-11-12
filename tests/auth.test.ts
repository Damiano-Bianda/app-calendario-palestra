import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { beforeEach, describe, expect, it } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import logoutHandler from '../server/api/auth/logout.post'
import meHandler from '../server/api/auth/me.get'
import recoverHandler from '../server/api/auth/recover.post'
import resetPasswordHandler from '../server/api/auth/reset-password.post'
import changeCenterHandler from '../server/api/settings/center.put'
import changePasswordHandler from '../server/api/settings/password.put'
import { centers, users, usersCenters } from '../server/db/schema'
import { seedDatabase } from '../server/db/seed'
import authMiddleware from '../server/middleware/auth'
import { SESSION_COOKIE_NAME } from '../server/utils/auth'
import {
  RECOVERY_TOKEN_TTL_MS,
  createRecoveryToken,
  generateRandomPassword,
  getPasswordHashTail,
  hashPassword,
  verifyPassword,
  verifyRecoveryToken,
} from '../server/utils/crypto'
import { createDb } from '../server/utils/db'
import { clearSentEmailsOutbox, sentEmailsOutbox } from '../server/utils/email'
import {
  createInMemorySqliteWithMigrations,
  createMockD1Database,
  createTestH3Event,
  extractSetCookieValue,
} from './helpers/mock-d1'

describe('Step 3: Auth, 30-Minute Stateless Recovery Token, Settings APIs & Middleware', () => {
  beforeEach(() => {
    clearSentEmailsOutbox()
  })

  it('encodes user_id, 30-minute expiration, and last 8 chars of password_hash in stateless HMAC recovery token', async () => {
    const secret = 'cloudflare-super-secret-key'
    const userId = uuidv7()
    const passwordHash = await hashPassword('MiaPassword123!')
    const nowMs = 1_760_000_000_000

    const token = await createRecoveryToken({ userId, passwordHash, nowMs }, secret)
    expect(token.split('.')).toHaveLength(2)

    // Decode payload part to verify exact claims encoded
    const [payloadB64] = token.split('.')
    const rawClaims = JSON.parse(
      Buffer.from(payloadB64!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
    )
    expect(rawClaims.uid).toBe(userId)
    expect(rawClaims.exp).toBe(nowMs + 30 * 60 * 1000)
    expect(rawClaims.pht).toBe(passwordHash.slice(-8))
    expect(rawClaims.pht).toHaveLength(8)
    expect(getPasswordHashTail(passwordHash)).toBe(passwordHash.slice(-8))

    // Valid within 30 minutes (e.g. at +29m59s)
    const verified = await verifyRecoveryToken(token, secret, nowMs + RECOVERY_TOKEN_TTL_MS - 1000)
    expect(verified).toEqual({
      userId,
      expiresAtMs: nowMs + RECOVERY_TOKEN_TTL_MS,
      passwordHashTail: passwordHash.slice(-8),
    })

    // Expired after 30 minutes (+30m + 1ms)
    const expired = await verifyRecoveryToken(token, secret, nowMs + RECOVERY_TOKEN_TTL_MS + 1)
    expect(expired).toBeNull()

    // Wrong secret fails HMAC verification
    const wrongSecret = await verifyRecoveryToken(token, 'wrong-secret', nowMs + 1000)
    expect(wrongSecret).toBeNull()

    // Tampered payload fails HMAC verification
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...rawClaims, exp: nowMs + 99_999_999 }),
    ).toString('base64url')
    const tamperedToken = `${tamperedPayload}.${token.split('.')[1]}`
    expect(await verifyRecoveryToken(tamperedToken, secret, nowMs + 1000)).toBeNull()

    // Random password generator produces valid length non-empty strings
    const randomPass = generateRandomPassword(14)
    expect(randomPass).toHaveLength(14)
  })

  it('authenticates Manager, Instructor, and Customer via POST /api/auth/login and returns role-specific defaultMode and defaultRedirect', async () => {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    const seed = await seedDatabase(db)
    const now = new Date().toISOString()

    // Add an Instructor-only user and a Customer-only user to the center
    const instructorId = uuidv7()
    await db.insert(users).values({
      id: instructorId,
      email: 'istruttore@palestra.it',
      passwordHash: await hashPassword('Istruttore123!'),
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: seed.centerId,
      userId: instructorId,
      name: 'Laura',
      surname: 'Bianchi',
      phoneNumber: '+393401112233',
      isManager: false,
      isAssistantManager: false,
      isInstructor: true,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })

    const customerId = uuidv7()
    await db.insert(users).values({
      id: customerId,
      email: 'cliente@palestra.it',
      passwordHash: await hashPassword('Cliente123!'),
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: seed.centerId,
      userId: customerId,
      name: 'Marco',
      surname: 'Verdi',
      phoneNumber: '+393409998877',
      isManager: false,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })

    // 1. Manager login -> defaultMode: 'worker', defaultRedirect: '/worker'
    const managerLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'Gerente123!' },
      d1,
    })
    const managerRes = await loginHandler(managerLoginEvent)
    expect(managerRes.defaultMode).toBe('worker')
    expect(managerRes.defaultRedirect).toBe('/worker')
    expect(managerRes.activeCenterId).toBe(seed.centerId)
    expect(managerRes.roles.isManager).toBe(true)

    const sessionCookie = extractSetCookieValue(managerLoginEvent, SESSION_COOKIE_NAME)
    expect(sessionCookie).toBeTruthy()

    // 2. Instructor login -> defaultMode: 'worker', defaultRedirect: '/worker/calendar'
    const instructorLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'istruttore@palestra.it', password: 'Istruttore123!' },
      d1,
    })
    const instructorRes = await loginHandler(instructorLoginEvent)
    expect(instructorRes.defaultMode).toBe('worker')
    expect(instructorRes.defaultRedirect).toBe('/worker/calendar')
    expect(instructorRes.roles.isInstructor).toBe(true)

    // 3. Customer login -> defaultMode: 'customer', defaultRedirect: '/customer'
    const customerLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'cliente@palestra.it', password: 'Cliente123!' },
      d1,
    })
    const customerRes = await loginHandler(customerLoginEvent)
    expect(customerRes.defaultMode).toBe('customer')
    expect(customerRes.defaultRedirect).toBe('/customer')

    // 4. Wrong password fails with 401
    const wrongPassEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'WrongPassword!' },
      d1,
    })
    await expect(loginHandler(wrongPassEvent)).rejects.toMatchObject({
      statusCode: 401,
    })

    // 5. GET /api/auth/me with Manager session cookie returns full profile and centers
    const meEvent = createTestH3Event({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: sessionCookie! },
      d1,
    })
    await authMiddleware(meEvent)
    const meRes = await meHandler(meEvent)
    expect(meRes.user.email).toBe('gerente@palestra.it')
    expect(meRes.user.name).toBe('Mario')
    expect(meRes.centers).toHaveLength(1)
    expect(meRes.centers[0]?.timezone).toBe('Europe/Rome')

    // 6. POST /api/auth/logout clears session cookie
    const logoutEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE_NAME]: sessionCookie! },
      d1,
    })
    await authMiddleware(logoutEvent)
    const logoutRes = await logoutHandler(logoutEvent)
    expect(logoutRes.success).toBe(true)
    expect(extractSetCookieValue(logoutEvent, SESSION_COOKIE_NAME)).toBe('')
  })

  it('executes the 30-minute stateless password recovery flow (/api/auth/recover -> /api/auth/reset-password) and enforces single-use via password_hash tail', async () => {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    await seedDatabase(db)

    // 1. Request password recovery link
    const recoverEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/recover',
      body: { email: 'gerente@palestra.it' },
      d1,
    })
    const recoverRes = await recoverHandler(recoverEvent)
    expect(recoverRes.success).toBe(true)
    expect(sentEmailsOutbox).toHaveLength(1)

    const emailText = sentEmailsOutbox[0]!.text
    const match = emailText.match(/https:\/\/palestra\.com\/recover\?token=([^\s]+)/)
    expect(match).toBeTruthy()
    const token = decodeURIComponent(match![1]!)

    // 2. Reset password using the token
    const resetEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/reset-password',
      body: {
        token,
        newPassword: 'NuovaPasswordSicura99!',
      },
      d1,
    })
    const resetRes = await resetPasswordHandler(resetEvent)
    expect(resetRes.success).toBe(true)

    // 3. Reusing the exact same token a second time MUST fail because password_hash last 8 chars changed
    const reuseEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/reset-password',
      body: {
        token,
        newPassword: 'AltraPassword99!',
      },
      d1,
    })
    await expect(resetPasswordHandler(reuseEvent)).rejects.toMatchObject({
      statusCode: 400,
    })

    // 4. Verify login works with the new password and fails with the old password
    const oldLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'Gerente123!' },
      d1,
    })
    await expect(loginHandler(oldLoginEvent)).rejects.toMatchObject({ statusCode: 401 })

    const newLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'NuovaPasswordSicura99!' },
      d1,
    })
    const newLoginRes = await loginHandler(newLoginEvent)
    expect(newLoginRes.user.email).toBe('gerente@palestra.it')
  })

  it('switches active center (PUT /api/settings/center) and changes personal password (PUT /api/settings/password)', async () => {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    const seed = await seedDatabase(db)
    const now = new Date().toISOString()

    // Create a second center (New York timezone) where Mario is a Customer (not Manager)
    const secondCenterId = uuidv7()
    await db.insert(centers).values({
      id: secondCenterId,
      name: 'Palestra Manhattan',
      timezone: 'America/New_York',
      createdBy: seed.adminId,
      updatedBy: seed.adminId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: secondCenterId,
      userId: seed.managerId,
      name: 'Mario',
      surname: 'Rossi NY',
      phoneNumber: '+12125551234',
      isManager: false,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: seed.adminId,
      updatedBy: seed.adminId,
      createdAt: now,
      updatedAt: now,
    })

    // Login as Mario
    const loginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'Gerente123!' },
      d1,
    })
    await loginHandler(loginEvent)
    const initialCookie = extractSetCookieValue(loginEvent, SESSION_COOKIE_NAME)!

    // Switch active center to Palestra Manhattan
    const switchEvent = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/center',
      cookies: { [SESSION_COOKIE_NAME]: initialCookie },
      body: { centerId: secondCenterId },
      d1,
    })
    await authMiddleware(switchEvent)
    const switchRes = await changeCenterHandler(switchEvent)
    expect(switchRes.activeCenterId).toBe(secondCenterId)
    expect(switchRes.activeCenter.timezone).toBe('America/New_York')
    expect(switchRes.defaultMode).toBe('customer')
    expect(switchRes.defaultRedirect).toBe('/customer')
    expect(switchRes.centers).toHaveLength(2)

    const switchedCookie = extractSetCookieValue(switchEvent, SESSION_COOKIE_NAME)!
    expect(switchedCookie).toBeTruthy()

    // Attempt to switch to a non-existent center fails with 403
    const badSwitchEvent = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/center',
      cookies: { [SESSION_COOKIE_NAME]: switchedCookie },
      body: { centerId: uuidv7() },
      d1,
    })
    await authMiddleware(badSwitchEvent)
    await expect(changeCenterHandler(badSwitchEvent)).rejects.toMatchObject({
      statusCode: 403,
    })

    // Change personal password via PUT /api/settings/password
    const badPassChangeEvent = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/password',
      cookies: { [SESSION_COOKIE_NAME]: switchedCookie },
      body: { currentPassword: 'WrongCurrentPassword', newPassword: 'ChangedPass123!' },
      d1,
    })
    await authMiddleware(badPassChangeEvent)
    await expect(changePasswordHandler(badPassChangeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })

    const passChangeEvent = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/password',
      cookies: { [SESSION_COOKIE_NAME]: switchedCookie },
      body: { currentPassword: 'Gerente123!', newPassword: 'ChangedPass123!' },
      d1,
    })
    await authMiddleware(passChangeEvent)
    const passChangeRes = await changePasswordHandler(passChangeEvent)
    expect(passChangeRes.success).toBe(true)

    const updatedUser = await db.query.users.findFirst({
      where: eq(users.id, seed.managerId),
    })
    expect(await verifyPassword('ChangedPass123!', updatedUser!.passwordHash)).toBe(true)
  })

  it('enforces active center membership (users_centers.deleted_at IS NULL) and role permissions in server middleware', async () => {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    const seed = await seedDatabase(db)
    const now = new Date().toISOString()

    // Create Instructor and Customer users
    const instructorId = uuidv7()
    const instructorMembershipId = uuidv7()
    await db.insert(users).values({
      id: instructorId,
      email: 'istruttore2@palestra.it',
      passwordHash: await hashPassword('Istruttore123!'),
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(usersCenters).values({
      id: instructorMembershipId,
      centerId: seed.centerId,
      userId: instructorId,
      name: 'Sara',
      surname: 'Neri',
      phoneNumber: '+393405556677',
      isManager: false,
      isAssistantManager: false,
      isInstructor: true,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })

    const customerId = uuidv7()
    await db.insert(users).values({
      id: customerId,
      email: 'cliente2@palestra.it',
      passwordHash: await hashPassword('Cliente123!'),
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: seed.centerId,
      userId: customerId,
      name: 'Paolo',
      surname: 'Gialli',
      phoneNumber: '+393408889900',
      isManager: false,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: now,
      updatedAt: now,
    })

    // Login Instructor & Customer
    const instrLogin = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'istruttore2@palestra.it', password: 'Istruttore123!' },
      d1,
    })
    await loginHandler(instrLogin)
    const instrCookie = extractSetCookieValue(instrLogin, SESSION_COOKIE_NAME)!

    const custLogin = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'cliente2@palestra.it', password: 'Cliente123!' },
      d1,
    })
    await loginHandler(custLogin)
    const custCookie = extractSetCookieValue(custLogin, SESSION_COOKIE_NAME)!

    // 1. Unauthenticated request to /api/classes -> 401
    const unauthEvent = createTestH3Event({
      method: 'GET',
      url: '/api/classes',
      d1,
    })
    await expect(authMiddleware(unauthEvent)).rejects.toMatchObject({ statusCode: 401 })

    // 2. Customer can access GET /api/classes (Tutti i ruoli), but is blocked on GET /api/users (Lavoratori) and POST /api/classes ((Vice) Gerente)
    const custGetClasses = createTestH3Event({
      method: 'GET',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: custCookie },
      d1,
    })
    await expect(authMiddleware(custGetClasses)).resolves.toBeUndefined()

    const custGetUsers = createTestH3Event({
      method: 'GET',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: custCookie },
      d1,
    })
    await expect(authMiddleware(custGetUsers)).rejects.toMatchObject({ statusCode: 403 })

    // 3. Instructor can access GET /api/users and GET /api/classes/:id (Lavoratori read-only), but is blocked on POST /api/classes ((Vice) Gerente)
    const instrGetUsers = createTestH3Event({
      method: 'GET',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: instrCookie },
      d1,
    })
    await expect(authMiddleware(instrGetUsers)).resolves.toBeUndefined()

    const instrPostClass = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: instrCookie },
      d1,
    })
    await expect(authMiddleware(instrPostClass)).rejects.toMatchObject({ statusCode: 403 })

    // 4. Soft-deleting Instructor's users_centers row immediately revokes access (403)
    await db
      .update(usersCenters)
      .set({
        deletedAt: new Date().toISOString(),
        updatedBy: seed.managerId,
      })
      .where(eq(usersCenters.id, instructorMembershipId))

    const instrAfterSoftDelete = createTestH3Event({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: instrCookie },
      d1,
    })
    await expect(authMiddleware(instrAfterSoftDelete)).rejects.toMatchObject({ statusCode: 403 })
  })
})

