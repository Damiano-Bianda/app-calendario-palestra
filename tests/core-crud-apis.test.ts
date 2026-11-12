import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { beforeEach, describe, expect, it } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import deleteClassHandler from '../server/api/classes/[id].delete'
import getClassHandler from '../server/api/classes/[id].get'
import updateClassHandler from '../server/api/classes/[id].put'
import listClassesHandler from '../server/api/classes/index.get'
import createClassHandler from '../server/api/classes/index.post'
import deleteSubscriptionHandler from '../server/api/subscriptions/[id].delete'
import getSubscriptionHandler from '../server/api/subscriptions/[id].get'
import updateSubscriptionHandler from '../server/api/subscriptions/[id].put'
import listSubscriptionsHandler from '../server/api/subscriptions/index.get'
import createSubscriptionHandler from '../server/api/subscriptions/index.post'
import deleteUserSubscriptionHandler from '../server/api/user-subscriptions/[id].delete'
import updateUserSubscriptionHandler from '../server/api/user-subscriptions/[id].put'
import listUserSubscriptionsHandler from '../server/api/user-subscriptions/index.get'
import createUserSubscriptionHandler from '../server/api/user-subscriptions/index.post'
import deleteUserHandler from '../server/api/users/[id].delete'
import getUserHandler from '../server/api/users/[id].get'
import updateUserHandler from '../server/api/users/[id].put'
import resetUserPasswordHandler from '../server/api/users/[id]/reset-password.post'
import updateUserRolesHandler from '../server/api/users/[id]/roles.put'
import sendUsersEmailHandler from '../server/api/users/email.post'
import listUsersHandler from '../server/api/users/index.get'
import createUserHandler from '../server/api/users/index.post'
import {
  centers,
  classes,
  schedules,
  subscriptions,
  userSchedules,
  usersCenters,
  usersSubscriptions,
} from '../server/db/schema'
import { seedDatabase } from '../server/db/seed'
import authMiddleware from '../server/middleware/auth'
import { SESSION_COOKIE_NAME } from '../server/utils/auth'
import { createDb } from '../server/utils/db'
import { clearSentEmailsOutbox, sentEmailsOutbox } from '../server/utils/email'
import {
  createInMemorySqliteWithMigrations,
  createMockD1Database,
  createTestH3Event,
  extractSetCookieValue,
} from './helpers/mock-d1'

describe('Step 4: Core CRUD APIs (Classes, Subscriptions, User-Subscriptions, Users) & Transactional Emails', () => {
  beforeEach(() => {
    clearSentEmailsOutbox()
  })

  async function setupTestEnvironment() {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    const seed = await seedDatabase(db)

    // Login as Manager (gerente@palestra.it)
    const loginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'Gerente123!' },
      d1,
    })
    await loginHandler(loginEvent)
    const managerCookie = extractSetCookieValue(loginEvent, SESSION_COOKIE_NAME)!

    return { sqlite, d1, db, seed, managerCookie }
  }

  it('implements Section 2 (/api/classes): CRUD, sorting/filtering, update notification email, and 409 schedule status deletion guard', async () => {
    const { d1, db, seed, managerCookie } = await setupTestEnvironment()

    // 1. Create two classes via POST /api/classes
    const createYogaEvent = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Yoga Dinamico',
        color: 'purple',
        description: 'Corso di Vinyasa Yoga',
      },
      d1,
    })
    await authMiddleware(createYogaEvent)
    const yogaRes = await createClassHandler(createYogaEvent)
    expect(yogaRes.class.name).toBe('Yoga Dinamico')
    expect(yogaRes.class.color).toBe('purple')

    const createPilatesEvent = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Pilates Matwork',
      },
      d1,
    })
    await authMiddleware(createPilatesEvent)
    const pilatesRes = await createClassHandler(createPilatesEvent)
    expect(pilatesRes.class.color).toBe('black') // Default color is black
    expect(pilatesRes.class.description).toBeNull()

    // 2. List classes via GET /api/classes with sorting and filtering
    const listEvent = createTestH3Event({
      method: 'GET',
      url: '/api/classes?search=yoga',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(listEvent)
    const listRes = await listClassesHandler(listEvent)
    expect(listRes.classes).toHaveLength(1)
    expect(listRes.classes[0]?.id).toBe(yogaRes.class.id)

    // 3. Create an ENROLLING schedule for Yoga Dinamico with an enrolled customer
    const createCustomerEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Giulia',
        surname: 'Bianchi',
        phoneNumber: '+393401234567',
        email: 'giulia@cliente.it',
      },
      d1,
    })
    await authMiddleware(createCustomerEvent)
    const customerRes = await createUserHandler(createCustomerEvent)
    clearSentEmailsOutbox()

    const nowMs = Date.now()
    const createdAtIso = new Date(nowMs - 60 * 60_000).toISOString()
    const futureStartIso = new Date(nowMs + 24 * 60 * 60_000).toISOString()

    // Create a subscription & user_subscription so we can insert a user_schedules row
    const subId = uuidv7()
    const userSubId = uuidv7()
    const scheduleId = uuidv7()

    await db.insert(subscriptions).values({
      id: subId,
      centerId: seed.centerId,
      name: 'Abbonamento Base',
      description: null,
      entrances: 10,
      durationDays: 30,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    })

    await db.insert(usersSubscriptions).values({
      id: userSubId,
      subscriptionId: subId,
      centerId: seed.centerId,
      userId: customerRes.user.id,
      startDate: createdAtIso,
      endDate: new Date(nowMs + 30 * 24 * 60 * 60_000).toISOString(),
      entrances: 10,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    })

    await db.insert(schedules).values({
      id: scheduleId,
      classId: yogaRes.class.id,
      centerId: seed.centerId,
      instructorId: null,
      startDate: futureStartIso,
      durationMinutes: 60,
      availableSpots: 15,
      minimumSpots: 1,
      publicationMinutesBefore: null,
      registrationOpenMinutesBefore: null,
      registrationCloseMinutesBefore: 60,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    })

    await db.insert(userSchedules).values({
      id: uuidv7(),
      centerId: seed.centerId,
      userId: customerRes.user.id,
      scheduleId,
      userSubscriptionId: userSubId,
      isQueued: false,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    })

    // 4. GET /api/classes/:id reports meta.hasEnrolledInEnrollingOrUpcoming = true
    const detailEvent = createTestH3Event({
      method: 'GET',
      url: `/api/classes/${yogaRes.class.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(detailEvent)
    const detailRes = await getClassHandler(detailEvent)
    expect(detailRes.meta.hasEnrolledInEnrollingOrUpcoming).toBe(true)
    expect(detailRes.meta.nonTerminatedSchedulesCount).toBe(1)

    // 5. PUT /api/classes/:id changing name/description with notifyEnrolled = true sends email to Giulia
    const updateEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/classes/${yogaRes.class.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Yoga Avanzato',
        color: 'blue',
        description: 'Nuova descrizione',
        notifyEnrolled: true,
        notificationMessage: 'Portare il tappetino personale.',
      },
      d1,
    })
    await authMiddleware(updateEvent)
    const updateRes = await updateClassHandler(updateEvent)
    expect(updateRes.class.name).toBe('Yoga Avanzato')
    expect(updateRes.notifiedCount).toBe(1)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toEqual(['giulia@cliente.it'])
    expect(sentEmailsOutbox[0]?.text).toContain('Portare il tappetino personale.')

    // 6. DELETE /api/classes/:id fails with 409 while ENROLLING schedule exists
    const blockedDeleteEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/classes/${yogaRes.class.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(blockedDeleteEvent)
    await expect(deleteClassHandler(blockedDeleteEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 7. Once the schedule is soft-deleted (CANCELLED_BY_PROVIDER), DELETE /api/classes/:id succeeds
    await db
      .update(schedules)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schedules.id, scheduleId))

    const allowedDeleteEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/classes/${yogaRes.class.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(allowedDeleteEvent)
    const deleteRes = await deleteClassHandler(allowedDeleteEvent)
    expect(deleteRes.success).toBe(true)

    const deletedClassRow = await db.query.classes.findFirst({
      where: eq(classes.id, yogaRes.class.id),
    })
    expect(deletedClassRow?.deletedAt).not.toBeNull()
  })

  it('implements Section 4 (/api/subscriptions) & Section 5 (/api/user-subscriptions) with all modification and deletion guards', async () => {
    const { d1, db, seed, managerCookie } = await setupTestEnvironment()

    // Create two classes
    const class1Event = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { name: 'CrossFit', color: 'red' },
      d1,
    })
    await authMiddleware(class1Event)
    const class1 = (await createClassHandler(class1Event)).class

    const class2Event = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { name: 'Calisthenics', color: 'green' },
      d1,
    })
    await authMiddleware(class2Event)
    const class2 = (await createClassHandler(class2Event)).class

    // 1. Create a subscription template via POST /api/subscriptions
    const createSubEvent = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: '10 Ingressi Fitness',
        description: 'Valido per CrossFit e Calisthenics',
        entrances: 10,
        durationDays: 30,
        classIds: [class1.id, class2.id],
      },
      d1,
    })
    await authMiddleware(createSubEvent)
    const subRes = await createSubscriptionHandler(createSubEvent)
    expect(subRes.subscription.name).toBe('10 Ingressi Fitness')
    expect(subRes.subscription.entrances).toBe(10)
    expect(subRes.subscription.durationDays).toBe(30)
    expect(subRes.subscription.classes).toHaveLength(2)

    // 2. PUT /api/subscriptions/:id updates only name & description and ignores structural fields
    const updateSubEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/subscriptions/${subRes.subscription.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Carnet 10 Fitness',
        description: 'Descrizione aggiornata',
        entrances: 999,
        durationDays: 365,
        classIds: [class1.id],
      },
      d1,
    })
    await authMiddleware(updateSubEvent)
    const updatedSub = (await updateSubscriptionHandler(updateSubEvent)).subscription
    expect(updatedSub.name).toBe('Carnet 10 Fitness')
    expect(updatedSub.description).toBe('Descrizione aggiornata')
    expect(updatedSub.entrances).toBe(10) // Unchanged!
    expect(updatedSub.durationDays).toBe(30) // Unchanged!
    expect(updatedSub.classes).toHaveLength(2) // Unchanged!

    // 3. Create a customer user and assign the subscription via POST /api/user-subscriptions
    const createCustEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Luca',
        surname: 'Neri',
        phoneNumber: '+393471122334',
        email: 'luca@cliente.it',
      },
      d1,
    })
    await authMiddleware(createCustEvent)
    const customer = (await createUserHandler(createCustEvent)).user

    const startIso = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    const createUserSubEvent = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: customer.id,
        subscriptionId: updatedSub.id,
        startDate: startIso,
      },
      d1,
    })
    await authMiddleware(createUserSubEvent)
    const userSubRes = await createUserSubscriptionHandler(createUserSubEvent)
    const userSub = userSubRes.userSubscription
    expect(userSub.entrances).toBe(10)
    expect(userSub.remainingEntrances).toBe(10)
    expect(userSub.isActive).toBe(true)
    expect(Date.parse(userSub.endDate!)).toBe(Date.parse(startIso) + 30 * 24 * 60 * 60_000)

    // 4. DELETE /api/subscriptions/:id is blocked with 409 because Luca has an active user subscription
    const blockedDeleteSubEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/subscriptions/${updatedSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(blockedDeleteSubEvent)
    await expect(deleteSubscriptionHandler(blockedDeleteSubEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 5. Enroll Luca into two lessons (1 COMPLETED in the past, 1 ENROLLING in 10 days)
    const nowMs = Date.now()
    const createdAtIso = new Date(nowMs - 5 * 24 * 60 * 60_000).toISOString()
    const pastLessonStart = new Date(nowMs - 24 * 60 * 60_000).toISOString()
    const futureLessonStart = new Date(nowMs + 10 * 24 * 60 * 60_000).toISOString()

    const pastScheduleId = uuidv7()
    const futureScheduleId = uuidv7()

    await db.insert(schedules).values([
      {
        id: pastScheduleId,
        classId: class1.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: pastLessonStart,
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: null,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
      {
        id: futureScheduleId,
        classId: class1.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: futureLessonStart,
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: null,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
    ])

    const futureEnrollmentId = uuidv7()
    await db.insert(userSchedules).values([
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.id,
        scheduleId: pastScheduleId,
        userSubscriptionId: userSub.id,
        isQueued: false,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
      {
        id: futureEnrollmentId,
        centerId: seed.centerId,
        userId: customer.id,
        scheduleId: futureScheduleId,
        userSubscriptionId: userSub.id,
        isQueued: false,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
    ])

    // 6. GET /api/user-subscriptions computes usedEntrances = 2, remainingEntrances = 8
    const listUserSubsEvent = createTestH3Event({
      method: 'GET',
      url: `/api/user-subscriptions?user=${customer.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(listUserSubsEvent)
    const listUserSubsRes = await listUserSubscriptionsHandler(listUserSubsEvent)
    expect(listUserSubsRes.userSubscriptions).toHaveLength(1)
    expect(listUserSubsRes.userSubscriptions[0]?.usedEntrances).toBe(2)
    expect(listUserSubsRes.userSubscriptions[0]?.remainingEntrances).toBe(8)

    // 7. PUT /api/user-subscriptions/:id blocks setting entrances < usedEntrances (e.g. 1 < 2) with 409
    const badEntrancesEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/user-subscriptions/${userSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        endDate: userSub.endDate,
        entrances: 1,
      },
      d1,
    })
    await authMiddleware(badEntrancesEvent)
    await expect(updateUserSubscriptionHandler(badEntrancesEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 8. PUT /api/user-subscriptions/:id blocks setting endDate before futureLessonStart (in 5 days < 10 days) with 409
    const badEndDateEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/user-subscriptions/${userSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        endDate: new Date(nowMs + 5 * 24 * 60 * 60_000).toISOString(),
        entrances: 10,
      },
      d1,
    })
    await authMiddleware(badEndDateEvent)
    await expect(updateUserSubscriptionHandler(badEndDateEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 9. PUT /api/user-subscriptions/:id succeeds when setting entrances = 5 (>= 2 used) and valid endDate
    const validUpdateUserSubEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/user-subscriptions/${userSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        endDate: new Date(nowMs + 20 * 24 * 60 * 60_000).toISOString(),
        entrances: 5,
      },
      d1,
    })
    await authMiddleware(validUpdateUserSubEvent)
    const updatedUserSubRes = await updateUserSubscriptionHandler(validUpdateUserSubEvent)
    expect(updatedUserSubRes.userSubscription.entrances).toBe(5)
    expect(updatedUserSubRes.userSubscription.remainingEntrances).toBe(3)

    // 10. DELETE /api/user-subscriptions/:id is blocked with 409 while futureScheduleId is active
    const blockedDeleteUserSubEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/user-subscriptions/${userSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(blockedDeleteUserSubEvent)
    await expect(deleteUserSubscriptionHandler(blockedDeleteUserSubEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // Soft-delete the future enrollment -> DELETE /api/user-subscriptions/:id now succeeds
    await db
      .update(userSchedules)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(userSchedules.id, futureEnrollmentId))

    const allowedDeleteUserSubEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/user-subscriptions/${userSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(allowedDeleteUserSubEvent)
    const delUserSubRes = await deleteUserSubscriptionHandler(allowedDeleteUserSubEvent)
    expect(delUserSubRes.success).toBe(true)

    // And now DELETE /api/subscriptions/:id also succeeds since no active user subscriptions remain
    const allowedDeleteSubEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/subscriptions/${updatedSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(allowedDeleteSubEvent)
    const delSubRes = await deleteSubscriptionHandler(allowedDeleteSubEvent)
    expect(delSubRes.success).toBe(true)

    const getDeletedSubEvent = createTestH3Event({
      method: 'GET',
      url: `/api/subscriptions/${updatedSub.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(getDeletedSubEvent)
    await expect(getSubscriptionHandler(getDeletedSubEvent)).rejects.toMatchObject({
      statusCode: 404,
    })

    const listSubsEvent = createTestH3Event({
      method: 'GET',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(listSubsEvent)
    const listSubsRes = await listSubscriptionsHandler(listSubsEvent)
    expect(listSubsRes.subscriptions).toHaveLength(0)
  })

  it('implements Section 6 (/api/users): new & multi-center user creation, role guards, password reset, custom emails, and all 4 deletion guards', async () => {
    const { d1, db, seed, managerCookie } = await setupTestEnvironment()

    // 1. Manager creates an Assistant Manager & Instructor via POST /api/users
    const createViceEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Elena',
        surname: 'Conti',
        phoneNumber: '+393331112223',
        email: 'elena@palestra.it',
        isAssistantManager: true,
        isInstructor: true,
      },
      d1,
    })
    await authMiddleware(createViceEvent)
    const viceRes = await createUserHandler(createViceEvent)
    expect(viceRes.isNewGlobalAccount).toBe(true)
    expect(viceRes.user.isAssistantManager).toBe(true)
    expect(viceRes.user.isInstructor).toBe(true)
    expect(sentEmailsOutbox).toHaveLength(1)

    // Extract temporary password from welcome email and verify Elena can log in
    const welcomeText = sentEmailsOutbox[0]!.text
    const tempPassMatch = welcomeText.match(/Password temporanea:\s*(\S+)/)
    expect(tempPassMatch).toBeTruthy()
    const elenaPassword = tempPassMatch![1]!

    const elenaLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'elena@palestra.it', password: elenaPassword },
      d1,
    })
    const elenaLoginRes = await loginHandler(elenaLoginEvent)
    expect(elenaLoginRes.roles.isAssistantManager).toBe(true)
    const elenaCookie = extractSetCookieValue(elenaLoginEvent, SESSION_COOKIE_NAME)!

    // 2. Assistant Manager (Elena) CANNOT create another Assistant Manager (403)
    const viceCreatesViceEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: elenaCookie },
      body: {
        name: 'Altro',
        surname: 'Vice',
        phoneNumber: '+393339998887',
        email: 'altrovice@palestra.it',
        isAssistantManager: true,
      },
      d1,
    })
    await authMiddleware(viceCreatesViceEvent)
    await expect(createUserHandler(viceCreatesViceEvent)).rejects.toMatchObject({
      statusCode: 403,
    })

    // 3. Duplicate email in the same center is blocked with 409
    const dupUserEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Elena',
        surname: 'Bis',
        phoneNumber: '+393331112223',
        email: 'ELENA@palestra.it',
      },
      d1,
    })
    await authMiddleware(dupUserEvent)
    await expect(createUserHandler(dupUserEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 4. Enabling an existing global user in a second center sends informational email (isNewGlobalAccount: false)
    const nowIso = new Date().toISOString()
    const secondCenterId = uuidv7()
    await db.insert(centers).values({
      id: secondCenterId,
      name: 'Palestra Milano Nord',
      timezone: 'Europe/Rome',
      createdBy: seed.adminId,
      updatedBy: seed.adminId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Create a user in secondCenterId first
    const multiCenterUserId = uuidv7()
    const multiCenterCreateInCenter1 = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: elenaCookie }, // Assistant Manager CAN create a customer
      body: {
        name: 'Davide',
        surname: 'Fontana',
        phoneNumber: '+393490001112',
        email: 'davide@cliente.it',
      },
      d1,
    })
    await authMiddleware(multiCenterCreateInCenter1)
    const davideRes = await createUserHandler(multiCenterCreateInCenter1)
    expect(davideRes.isNewGlobalAccount).toBe(true)
    void multiCenterUserId

    // Add Mario as manager of secondCenterId and enable Davide in secondCenterId
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: secondCenterId,
      userId: seed.managerId,
      name: 'Mario',
      surname: 'Rossi',
      phoneNumber: '+393330001112',
      isManager: true,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: seed.adminId,
      updatedBy: seed.adminId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    clearSentEmailsOutbox()
    // Soft-delete Davide from center 1, then re-enable him in center 1 to test existing global user path
    const deleteDavideEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/users/${davideRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteDavideEvent)
    await deleteUserHandler(deleteDavideEvent)

    const reEnableDavideEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Davide',
        surname: 'Fontana',
        phoneNumber: '+393490001112',
        email: 'davide@cliente.it',
      },
      d1,
    })
    await authMiddleware(reEnableDavideEvent)
    const reEnableRes = await createUserHandler(reEnableDavideEvent)
    expect(reEnableRes.isNewGlobalAccount).toBe(false)
    expect(reEnableRes.user.id).toBe(davideRes.user.id)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.subject).toContain('Abilitazione nuova sede')

    // 5. PUT /api/users/:id updates profile fields
    const updateProfileEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/users/${davideRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: elenaCookie },
      body: {
        name: 'Davide Maria',
        surname: 'Fontana',
        phoneNumber: '+393499999999',
      },
      d1,
    })
    await authMiddleware(updateProfileEvent)
    const updatedProfileRes = await updateUserHandler(updateProfileEvent)
    expect(updatedProfileRes.user.name).toBe('Davide Maria')
    expect(updatedProfileRes.user.phoneNumber).toBe('+393499999999')

    // 6. PUT /api/users/:id/roles:
    // Assign an upcoming lesson to Elena (instructor) and verify removing isInstructor is blocked with 409
    const courseId = uuidv7()
    await db.insert(classes).values({
      id: courseId,
      centerId: seed.centerId,
      name: 'Boxe',
      description: null,
      color: 'red',
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const instructorSchedId = uuidv7()
    await db.insert(schedules).values({
      id: instructorSchedId,
      classId: courseId,
      centerId: seed.centerId,
      instructorId: viceRes.user.id,
      startDate: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      durationMinutes: 60,
      availableSpots: 20,
      minimumSpots: 1,
      publicationMinutesBefore: null,
      registrationOpenMinutesBefore: null,
      registrationCloseMinutesBefore: null,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const removeInstrBlockedEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/users/${viceRes.user.id}/roles`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        isInstructor: false,
        isAssistantManager: true,
      },
      d1,
    })
    await authMiddleware(removeInstrBlockedEvent)
    await expect(updateUserRolesHandler(removeInstrBlockedEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // Also DELETE /api/users/:id for Elena is blocked with 409 while she has an active assigned schedule
    const deleteInstrBlockedEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/users/${viceRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteInstrBlockedEvent)
    await expect(deleteUserHandler(deleteInstrBlockedEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // Cancel the schedule -> now Elena's instructor role can be removed
    await db
      .update(schedules)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schedules.id, instructorSchedId))

    const removeInstrAllowedEvent = createTestH3Event({
      method: 'PUT',
      url: `/api/users/${viceRes.user.id}/roles`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        isInstructor: false,
        isAssistantManager: true,
      },
      d1,
    })
    await authMiddleware(removeInstrAllowedEvent)
    const roleUpdatedRes = await updateUserRolesHandler(removeInstrAllowedEvent)
    expect(roleUpdatedRes.user.isInstructor).toBe(false)

    // 7. POST /api/users/:id/reset-password generates new random password and sends email
    clearSentEmailsOutbox()
    const adminResetPassEvent = createTestH3Event({
      method: 'POST',
      url: `/api/users/${davideRes.user.id}/reset-password`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(adminResetPassEvent)
    const resetPassRes = await resetUserPasswordHandler(adminResetPassEvent)
    expect(resetPassRes.success).toBe(true)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toBe('davide@cliente.it')

    // 8. POST /api/users/email sends custom communication email to selected center users
    clearSentEmailsOutbox()
    const customEmailEvent = createTestH3Event({
      method: 'POST',
      url: '/api/users/email',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userIds: [davideRes.user.id, viceRes.user.id],
        subject: 'Chiusura festiva',
        message: 'La palestra resterà chiusa il 25 dicembre.',
      },
      d1,
    })
    await authMiddleware(customEmailEvent)
    const customEmailRes = await sendUsersEmailHandler(customEmailEvent)
    expect(customEmailRes.success).toBe(true)
    expect(customEmailRes.sentCount).toBe(2)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.subject).toContain('Chiusura festiva')

    // 9. DELETE /api/users/:id blocks deleting the Manager (409)
    const deleteManagerEvent = createTestH3Event({
      method: 'DELETE',
      url: `/api/users/${seed.managerId}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteManagerEvent)
    await expect(deleteUserHandler(deleteManagerEvent)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 10. GET /api/users and GET /api/users/:id list and inspect center users
    const listUsersEvent = createTestH3Event({
      method: 'GET',
      url: '/api/users?search=davide',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(listUsersEvent)
    const listUsersRes = await listUsersHandler(listUsersEvent)
    expect(listUsersRes.users).toHaveLength(1)
    expect(listUsersRes.users[0]?.id).toBe(davideRes.user.id)

    const getUserDetailEvent = createTestH3Event({
      method: 'GET',
      url: `/api/users/${davideRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(getUserDetailEvent)
    const getUserDetailRes = await getUserHandler(getUserDetailEvent)
    expect(getUserDetailRes.user.email).toBe('davide@cliente.it')
    expect(getUserDetailRes.subscriptions).toEqual([])

    // 11. Verify User Deletion Guard 2 (active customer lesson) and Guard 3 (active user subscription),
    // plus Customer read isolation on GET /api/user-subscriptions
    const newPassText = sentEmailsOutbox[0]!.text
    //Wait: sentEmailsOutbox[0] was the custom email from step 8; let's reset Davide's password to get his login cookie
    clearSentEmailsOutbox()
    const resetDavideAgain = createTestH3Event({
      method: 'POST',
      url: `/api/users/${davideRes.user.id}/reset-password`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(resetDavideAgain)
    await resetUserPasswordHandler(resetDavideAgain)
    const davidePassMatch = sentEmailsOutbox[0]!.text.match(/Nuova password:\s*(\S+)/)
    expect(davidePassMatch).toBeTruthy()
    void newPassText

    const davideLoginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'davide@cliente.it', password: davidePassMatch![1]! },
      d1,
    })
    await loginHandler(davideLoginEvent)
    const davideCookie = extractSetCookieValue(davideLoginEvent, SESSION_COOKIE_NAME)!

    // Customer cannot query another user's subscriptions (403)
    const custForbiddenSubQuery = createTestH3Event({
      method: 'GET',
      url: `/api/user-subscriptions?userId=${seed.managerId}`,
      cookies: { [SESSION_COOKIE_NAME]: davideCookie },
      d1,
    })
    await authMiddleware(custForbiddenSubQuery)
    await expect(listUserSubscriptionsHandler(custForbiddenSubQuery)).rejects.toMatchObject({
      statusCode: 403,
    })

    // Assign an active subscription to Davide -> DELETE /api/users/:id is blocked with 409 (Guard 3)
    const subTemplateId = uuidv7()
    await db.insert(subscriptions).values({
      id: subTemplateId,
      centerId: seed.centerId,
      name: 'Abbonamento Boxe',
      description: null,
      entrances: 5,
      durationDays: 30,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const assignDavideSub = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: davideRes.user.id,
        subscriptionId: subTemplateId,
        startDate: nowIso,
      },
      d1,
    })
    await authMiddleware(assignDavideSub)
    const davideUserSub = (await createUserSubscriptionHandler(assignDavideSub)).userSubscription

    // Customer can query their own subscriptions via GET /api/user-subscriptions
    const custOwnSubQuery = createTestH3Event({
      method: 'GET',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: davideCookie },
      d1,
    })
    await authMiddleware(custOwnSubQuery)
    const custOwnSubRes = await listUserSubscriptionsHandler(custOwnSubQuery)
    expect(custOwnSubRes.userSubscriptions).toHaveLength(1)
    expect(custOwnSubRes.userSubscriptions[0]?.id).toBe(davideUserSub.id)

    // Guard 3: Deleting Davide fails with 409 while he has an active user subscription
    const deleteDavideWithActiveSub = createTestH3Event({
      method: 'DELETE',
      url: `/api/users/${davideRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteDavideWithActiveSub)
    await expect(deleteUserHandler(deleteDavideWithActiveSub)).rejects.toMatchObject({
      statusCode: 409,
    })

    // Enroll Davide in an active ENROLLING lesson -> Guard 2 also blocks deletion
    const activeLessonId = uuidv7()
    await db.insert(schedules).values({
      id: activeLessonId,
      classId: courseId,
      centerId: seed.centerId,
      instructorId: null,
      startDate: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      durationMinutes: 60,
      availableSpots: 10,
      minimumSpots: 1,
      publicationMinutesBefore: null,
      registrationOpenMinutesBefore: null,
      registrationCloseMinutesBefore: null,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(userSchedules).values({
      id: uuidv7(),
      centerId: seed.centerId,
      userId: davideRes.user.id,
      scheduleId: activeLessonId,
      userSubscriptionId: davideUserSub.id,
      isQueued: false,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const deleteDavideWithActiveLesson = createTestH3Event({
      method: 'DELETE',
      url: `/api/users/${davideRes.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteDavideWithActiveLesson)
    await expect(deleteUserHandler(deleteDavideWithActiveLesson)).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})
