import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { beforeEach, describe, expect, it } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import createClassHandler from '../server/api/classes/index.post'
import customerSummaryHandler from '../server/api/customer/summary.get'
import deleteScheduleHandler from '../server/api/schedules/[id].delete'
import getScheduleHandler from '../server/api/schedules/[id].get'
import updateScheduleHandler from '../server/api/schedules/[id].put'
import scheduleEmailHandler from '../server/api/schedules/[id]/email.post'
import enrollScheduleHandler from '../server/api/schedules/[id]/enroll.post'
import unenrollScheduleHandler from '../server/api/schedules/[id]/enroll/[userId].delete'
import listSchedulesHandler from '../server/api/schedules/index.get'
import createSchedulesHandler from '../server/api/schedules/index.post'
import createSubscriptionHandler from '../server/api/subscriptions/index.post'
import listUserSubscriptionsHandler from '../server/api/user-subscriptions/index.get'
import createUserSubscriptionHandler from '../server/api/user-subscriptions/index.post'
import createUserHandler from '../server/api/users/index.post'
import { schedules, userSchedules } from '../server/db/schema'
import { seedDatabase } from '../server/db/seed'
import authMiddleware from '../server/middleware/auth'
import { SESSION_COOKIE_NAME } from '../server/utils/auth'
import { createDb } from '../server/utils/db'
import { clearSentEmailsOutbox, sentEmailsOutbox } from '../server/utils/email'
import { formatCenterDate } from '../shared/utils/timezone'
import {
  createInMemorySqliteWithMigrations,
  createMockD1Database,
  createTestH3Event,
  extractSetCookieValue,
} from './helpers/mock-d1'

describe('Step 5: Schedules, Enrollment, Queue Promotion & Customer Summary APIs (Sections 3 & 7)', () => {
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

    // Create a sample course (Yoga)
    const createCourseEvent = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Vinyasa Yoga',
        color: 'purple',
        description: 'Corso di Yoga dinamico',
      },
      d1,
    })
    await authMiddleware(createCourseEvent)
    const course = (await createClassHandler(createCourseEvent)).class

    return { sqlite, d1, db, seed, managerCookie, course }
  }

  async function createAndLoginUser(
    d1: ReturnType<typeof createMockD1Database>,
    managerCookie: string,
    params: {
      name: string
      surname: string
      phoneNumber: string
      email: string
      isInstructor?: boolean
      isAssistantManager?: boolean
    },
  ) {
    clearSentEmailsOutbox()
    const createEv = createTestH3Event({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: params,
      d1,
    })
    await authMiddleware(createEv)
    const res = await createUserHandler(createEv)
    const welcomeText = sentEmailsOutbox[0]!.text
    const password = welcomeText.match(/Password temporanea:\s*(\S+)/)![1]!
    clearSentEmailsOutbox()

    const loginEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: params.email, password },
      d1,
    })
    await loginHandler(loginEv)
    const cookie = extractSetCookieValue(loginEv, SESSION_COOKIE_NAME)!

    return { user: res.user, cookie, password }
  }

  it('creates recurring schedules atomically (POST /api/schedules), enforces 5-minute creation & timeline guards, and filtersDRAFT for customers (GET /api/schedules)', async () => {
    const { d1, managerCookie, course } = await setupTestEnvironment()

    const instructor = await createAndLoginUser(d1, managerCookie, {
      name: 'Marco',
      surname: 'Istruttore',
      phoneNumber: '+393401112233',
      email: 'marco@istruttore.it',
      isInstructor: true,
    })

    const customer = await createAndLoginUser(d1, managerCookie, {
      name: 'Chiara',
      surname: 'Cliente',
      phoneNumber: '+393404445566',
      email: 'chiara@cliente.it',
    })

    // Pick a 14-day window starting 10 days in the future so all occurrences are well beyond now + 5 min
    const baseFutureMs = Date.now() + 10 * 24 * 60 * 60_000
    const rangeStartStr = new Date(baseFutureMs).toISOString().slice(0, 10)
    const rangeEndStr = new Date(baseFutureMs + 13 * 24 * 60 * 60_000).toISOString().slice(0, 10)

    // 1. Create recurring schedules on Mondays (1) and Wednesdays (3) at 18:30 Europe/Rome
    const createRecEvent = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: course.id,
        rangeStartDate: rangeStartStr,
        rangeEndDate: rangeEndStr,
        daysOfWeek: [1, 3], // Monday and Wednesday
        startTime: '18:30',
        durationMinutes: 60,
        minimumSpots: 2,
        availableSpots: 10,
        instructorId: instructor.user.id,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 60,
      },
      d1,
    })
    await authMiddleware(createRecEvent)
    const recRes = await createSchedulesHandler(createRecEvent)

    // In a 14-day window there are exactly 2 Mondays and 2 Wednesdays = 4 schedules
    expect(recRes.createdCount).toBe(4)
    expect(recRes.schedules).toHaveLength(4)
    expect(recRes.schedules[0]?.status).toBe('ENROLLING')
    expect(recRes.schedules[0]?.remainingSpots).toBe(10)
    expect(recRes.schedules[0]?.instructor?.id).toBe(instructor.user.id)

    // 2. Also create a DRAFT schedule (publication 60 mins before start, registrationOpen 30 mins before start)
    const draftDateStr = new Date(Date.now() + 20 * 24 * 60 * 60_000).toISOString().slice(0, 10)
    const draftDow = new Date(`${draftDateStr}T00:00:00.000Z`).getUTCDay()

    const createDraftEvent = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: course.id,
        rangeStartDate: draftDateStr,
        rangeEndDate: draftDateStr,
        daysOfWeek: [draftDow],
        startTime: '10:00',
        durationMinutes: 45,
        minimumSpots: 1,
        availableSpots: 8,
        publicationMinutesBefore: 60,
        registrationOpenMinutesBefore: 30,
        registrationCloseMinutesBefore: 10,
      },
      d1,
    })
    await authMiddleware(createDraftEvent)
    const draftRes = await createSchedulesHandler(createDraftEvent)
    expect(draftRes.schedules).toHaveLength(1)
    const draftSchedule = draftRes.schedules[0]!
    expect(draftSchedule.status).toBe('DRAFT')

    // 3. Verify 5-minute creation margin guard: a lesson whose registrationClose is in the past or < now + 5m fails with 400
    const badMarginEvent = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: course.id,
        rangeStartDate: draftDateStr,
        rangeEndDate: draftDateStr,
        daysOfWeek: [draftDow],
        startTime: '10:00',
        durationMinutes: 45,
        minimumSpots: 1,
        availableSpots: 8,
        // 40,000 minutes (~27.7 days) before startDate puts registrationClose in the past (< now + 5m)
        registrationCloseMinutesBefore: 40_000,
      },
      d1,
    })
    await authMiddleware(badMarginEvent)
    await expect(createSchedulesHandler(badMarginEvent)).rejects.toMatchObject({
      statusCode: 400,
    })

    // 4. GET /api/schedules: Worker sees all 5 schedules (including DRAFT), Customer sees only 4 (DRAFT excluded)
    const workerListEvent = createTestH3Event({
      method: 'GET',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(workerListEvent)
    const workerListRes = await listSchedulesHandler(workerListEvent)
    expect(workerListRes.schedules).toHaveLength(5)

    const customerListEvent = createTestH3Event({
      method: 'GET',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: customer.cookie },
      d1,
    })
    await authMiddleware(customerListEvent)
    const customerListRes = await listSchedulesHandler(customerListEvent)
    expect(customerListRes.schedules).toHaveLength(4)
    expect(customerListRes.schedules.every((s) => s.status !== 'DRAFT')).toBe(true)

    // 5. GET /api/schedules?date=...&view=day returns only the schedule on that specific local date
    const firstScheduleLocalDate = formatCenterDate(
      recRes.schedules[0]!.startDate,
      'Europe/Rome',
    )
      .split('/')
      .reverse()
      .join('-')

    const dayViewEvent = createTestH3Event({
      method: 'GET',
      url: `/api/schedules?date=${firstScheduleLocalDate}&view=day`,
      cookies: { [SESSION_COOKIE_NAME]: customer.cookie },
      d1,
    })
    await authMiddleware(dayViewEvent)
    const dayViewRes = await listSchedulesHandler(dayViewEvent)
    expect(dayViewRes.schedules).toHaveLength(1)
    expect(dayViewRes.schedules[0]?.id).toBe(recRes.schedules[0]?.id)

    // 6. GET /api/schedules/:id blocks customer from viewing DRAFT schedule (404), allows worker
    const customerDraftDetailEv = createTestH3Event({
      method: 'GET',
      url: `/api/schedules/${draftSchedule.id}`,
      cookies: { [SESSION_COOKIE_NAME]: customer.cookie },
      d1,
    })
    await authMiddleware(customerDraftDetailEv)
    await expect(getScheduleHandler(customerDraftDetailEv)).rejects.toMatchObject({
      statusCode: 404,
    })

    const workerDraftDetailEv = createTestH3Event({
      method: 'GET',
      url: `/api/schedules/${draftSchedule.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(workerDraftDetailEv)
    const workerDraftDetailRes = await getScheduleHandler(workerDraftDetailEv)
    expect(workerDraftDetailRes.schedule.id).toBe(draftSchedule.id)
    expect(workerDraftDetailRes.meta?.canEdit).toBe(true)
    expect(workerDraftDetailRes.meta?.canDelete).toBe(true)
  })

  it('enforces PUT /api/schedules/:id and DELETE /api/schedules/:id status guards, cancellation emails, and entrance restoration', async () => {
    const { d1, db, seed, managerCookie, course } = await setupTestEnvironment()

    const customer = await createAndLoginUser(d1, managerCookie, {
      name: 'Paolo',
      surname: 'Verdi',
      phoneNumber: '+393479988776',
      email: 'paolo@cliente.it',
    })

    const nowMs = Date.now()
    const createdAtIso = new Date(nowMs - 2 * 60 * 60_000).toISOString()

    // Insert 1 PUBLISHED schedule and 1 ENROLLING schedule and 1 ACTIVE schedule
    const publishedId = uuidv7()
    const enrollingId = uuidv7()
    const activeId = uuidv7()

    await db.insert(schedules).values([
      {
        id: publishedId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs + 48 * 60 * 60_000).toISOString(),
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null, // immediately published
        registrationOpenMinutesBefore: 120, // opens 2h before start -> currently PUBLISHED
        registrationCloseMinutesBefore: 30,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
      {
        id: enrollingId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null, // currently ENROLLING
        registrationCloseMinutesBefore: 30,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
      {
        id: activeId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs - 15 * 60_000).toISOString(), // started 15m ago -> ACTIVE
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

    // Create a subscription with 5 entrances for Paolo and enroll him into enrollingId and activeId
    const createSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Carnet 5 Yoga',
        entrances: 5,
        durationDays: 30,
        classIds: [course.id],
      },
      d1,
    })
    await authMiddleware(createSubEv)
    const subTemplate = (await createSubscriptionHandler(createSubEv)).subscription

    const assignSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: customer.user.id,
        subscriptionId: subTemplate.id,
        startDate: createdAtIso,
      },
      d1,
    })
    await authMiddleware(assignSubEv)
    const userSub = (await createUserSubscriptionHandler(assignSubEv)).userSubscription

    await db.insert(userSchedules).values([
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: enrollingId,
        userSubscriptionId: userSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: activeId,
        userSubscriptionId: userSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
      },
    ])

    // 1. PUT /api/schedules/:id succeeds on PUBLISHED schedule
    const newStartIso = new Date(
      Math.ceil((nowMs + 72 * 60 * 60_000) / (5 * 60_000)) * (5 * 60_000),
    ).toISOString()

    const updatePubEv = createTestH3Event({
      method: 'PUT',
      url: `/api/schedules/${publishedId}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: course.id,
        startDate: newStartIso,
        durationMinutes: 75,
        minimumSpots: 3,
        availableSpots: 12,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: 120,
        registrationCloseMinutesBefore: 30,
      },
      d1,
    })
    await authMiddleware(updatePubEv)
    const updatedPubRes = await updateScheduleHandler(updatePubEv)
    expect(updatedPubRes.schedule.durationMinutes).toBe(75)
    expect(updatedPubRes.schedule.availableSpots).toBe(12)

    // 2. PUT /api/schedules/:id fails with 409 on ENROLLING schedule
    const updateEnrollingEv = createTestH3Event({
      method: 'PUT',
      url: `/api/schedules/${enrollingId}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: course.id,
        startDate: newStartIso,
        durationMinutes: 60,
        minimumSpots: 1,
        availableSpots: 10,
      },
      d1,
    })
    await authMiddleware(updateEnrollingEv)
    await expect(updateScheduleHandler(updateEnrollingEv)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 3. DELETE /api/schedules/:id fails with 409 on ACTIVE schedule
    const deleteActiveEv = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${activeId}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(deleteActiveEv)
    await expect(deleteScheduleHandler(deleteActiveEv)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 4. DELETE /api/schedules/:id succeeds on ENROLLING schedule, sets status = CANCELLED_BY_PROVIDER, sends email, and restores Paolo's entrance!
    clearSentEmailsOutbox()
    const deleteEnrollingEv = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${enrollingId}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        notifyEnrolled: true,
        notificationMessage: 'Insegnante indisposto, ci scusiamo per il disagio.',
      },
      d1,
    })
    await authMiddleware(deleteEnrollingEv)
    const deleteEnrollingRes = await deleteScheduleHandler(deleteEnrollingEv)
    expect(deleteEnrollingRes.success).toBe(true)
    expect(deleteEnrollingRes.schedule.status).toBe('CANCELLED_BY_PROVIDER')
    expect(deleteEnrollingRes.notifiedCount).toBe(1)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toEqual(['paolo@cliente.it'])
    expect(sentEmailsOutbox[0]?.text).toContain('Insegnante indisposto')

    // Verify Paolo's usedEntrances dropped from 2 to 1 (remainingEntrances restored from 3 to 4)
    const checkSubsEv = createTestH3Event({
      method: 'GET',
      url: `/api/user-subscriptions?user=${customer.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      d1,
    })
    await authMiddleware(checkSubsEv)
    const subsRes = await listUserSubscriptionsHandler(checkSubsEv)
    expect(subsRes.userSubscriptions[0]?.usedEntrances).toBe(1)
    expect(subsRes.userSubscriptions[0]?.remainingEntrances).toBe(4)
  })

  it('automatically selects the eligible subscription expiring soonest on enrollment, manages the waiting queue, promotes the oldest queued user on unenrollment, and sends emails', async () => {
    const { d1, db, seed, managerCookie, course } = await setupTestEnvironment()

    const instructor = await createAndLoginUser(d1, managerCookie, {
      name: 'Sara',
      surname: 'Istruttrice',
      phoneNumber: '+393331020304',
      email: 'sara@istruttore.it',
      isInstructor: true,
    })

    const otherInstructor = await createAndLoginUser(d1, managerCookie, {
      name: 'Luca',
      surname: 'AltroIstruttore',
      phoneNumber: '+393331020305',
      email: 'luca@istruttore.it',
      isInstructor: true,
    })

    const cust1 = await createAndLoginUser(d1, managerCookie, {
      name: 'Anna',
      surname: 'Uno',
      phoneNumber: '+393400000001',
      email: 'anna@cliente.it',
    })
    const cust2 = await createAndLoginUser(d1, managerCookie, {
      name: 'Bruno',
      surname: 'Due',
      phoneNumber: '+393400000002',
      email: 'bruno@cliente.it',
    })
    const cust3 = await createAndLoginUser(d1, managerCookie, {
      name: 'Carla',
      surname: 'Tre',
      phoneNumber: '+393400000003',
      email: 'carla@cliente.it',
    })
    const cust4 = await createAndLoginUser(d1, managerCookie, {
      name: 'Diego',
      surname: 'Quattro',
      phoneNumber: '+393400000004',
      email: 'diego@cliente.it',
    })

    // Create 3 subscription templates: 15-day (expiring soonest), 60-day, and unlimited
    const createSub15Ev = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { name: 'Promo 15 Giorni', entrances: 5, durationDays: 15, classIds: [course.id] },
      d1,
    })
    await authMiddleware(createSub15Ev)
    const sub15 = (await createSubscriptionHandler(createSub15Ev)).subscription

    const createSub60Ev = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { name: 'Standard 60 Giorni', entrances: 10, durationDays: 60, classIds: [course.id] },
      d1,
    })
    await authMiddleware(createSub60Ev)
    const sub60 = (await createSubscriptionHandler(createSub60Ev)).subscription

    const nowMs = Date.now()
    const subStartIso = new Date(nowMs - 24 * 60 * 60_000).toISOString()

    // Assign BOTH sub60 and sub15 to Anna (cust1) -> enrollment MUST pick sub15 (expiring soonest!)
    const assignAnna60Ev = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { userId: cust1.user.id, subscriptionId: sub60.id, startDate: subStartIso },
      d1,
    })
    await authMiddleware(assignAnna60Ev)
    const annaSub60 = (await createUserSubscriptionHandler(assignAnna60Ev)).userSubscription

    const assignAnna15Ev = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { userId: cust1.user.id, subscriptionId: sub15.id, startDate: subStartIso },
      d1,
    })
    await authMiddleware(assignAnna15Ev)
    const annaSub15 = (await createUserSubscriptionHandler(assignAnna15Ev)).userSubscription

    // Assign sub60 to Bruno, Carla, and Diego
    for (const c of [cust2, cust3, cust4]) {
      const assignEv = createTestH3Event({
        method: 'POST',
        url: '/api/user-subscriptions',
        cookies: { [SESSION_COOKIE_NAME]: managerCookie },
        body: { userId: c.user.id, subscriptionId: sub60.id, startDate: subStartIso },
        d1,
      })
      await authMiddleware(assignEv)
      await createUserSubscriptionHandler(assignEv)
    }

    // Create an ENROLLING schedule with availableSpots = 2, minimumSpots = 1, in 5 days
    const scheduleId = uuidv7()
    const lessonStartIso = new Date(
      Math.ceil((nowMs + 5 * 24 * 60 * 60_000) / (5 * 60_000)) * (5 * 60_000),
    ).toISOString()

    await db.insert(schedules).values({
      id: scheduleId,
      classId: course.id,
      centerId: seed.centerId,
      instructorId: instructor.user.id,
      startDate: lessonStartIso,
      durationMinutes: 60,
      availableSpots: 2,
      minimumSpots: 1,
      publicationMinutesBefore: null,
      registrationOpenMinutesBefore: null,
      registrationCloseMinutesBefore: 60,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: subStartIso,
      updatedAt: subStartIso,
    })

    // 1. Anna enrolls herself -> selects annaSub15 (expiring soonest), isQueued = false, no manager email
    clearSentEmailsOutbox()
    const enrollAnnaEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/enroll`,
      cookies: { [SESSION_COOKIE_NAME]: cust1.cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollAnnaEv)
    const annaEnrollRes = await enrollScheduleHandler(enrollAnnaEv)
    expect(annaEnrollRes.isQueued).toBe(false)
    expect(annaEnrollRes.selectedSubscriptionId).toBe(annaSub15.id)
    expect(annaEnrollRes.selectedSubscriptionId).not.toBe(annaSub60.id)
    expect(annaEnrollRes.notifiedCustomer).toBe(false)
    expect(sentEmailsOutbox).toHaveLength(0)

    // Duplicate enrollment by Anna is rejected with 409
    const dupAnnaEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/enroll`,
      cookies: { [SESSION_COOKIE_NAME]: cust1.cookie },
      body: {},
      d1,
    })
    await authMiddleware(dupAnnaEv)
    await expect(enrollScheduleHandler(dupAnnaEv)).rejects.toMatchObject({
      statusCode: 409,
    })

    // 2. Manager enrolls Bruno (spot 2 of 2) -> isQueued = false, sends manager enrollment email!
    clearSentEmailsOutbox()
    const enrollBrunoByManagerEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/enroll`,
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { userId: cust2.user.id },
      d1,
    })
    await authMiddleware(enrollBrunoByManagerEv)
    const brunoEnrollRes = await enrollScheduleHandler(enrollBrunoByManagerEv)
    expect(brunoEnrollRes.isQueued).toBe(false)
    expect(brunoEnrollRes.notifiedCustomer).toBe(true)
    expect(brunoEnrollRes.schedule.enrolledCount).toBe(2)
    expect(brunoEnrollRes.schedule.remainingSpots).toBe(0)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toBe('bruno@cliente.it')
    expect(sentEmailsOutbox[0]?.subject).toContain('Conferma iscrizione')

    // 3. Lesson is now full (2/2). Carla and Diego enroll -> placed in queue (isQueued = true, queuePosition 1 and 2)
    const enrollCarlaEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/enroll`,
      cookies: { [SESSION_COOKIE_NAME]: cust3.cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollCarlaEv)
    const carlaEnrollRes = await enrollScheduleHandler(enrollCarlaEv)
    expect(carlaEnrollRes.isQueued).toBe(true)
    expect(carlaEnrollRes.schedule.queuedCount).toBe(1)
    expect(carlaEnrollRes.schedule.userEnrollment.isQueued).toBe(true)
    expect(carlaEnrollRes.schedule.userEnrollment.queuePosition).toBe(1)
    expect(carlaEnrollRes.schedule.customerStatusLabel).toBe('Coda')

    const enrollDiegoEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/enroll`,
      cookies: { [SESSION_COOKIE_NAME]: cust4.cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollDiegoEv)
    const diegoEnrollRes = await enrollScheduleHandler(enrollDiegoEv)
    expect(diegoEnrollRes.isQueued).toBe(true)
    expect(diegoEnrollRes.schedule.queuedCount).toBe(2)
    expect(diegoEnrollRes.schedule.userEnrollment.queuePosition).toBe(2)

    // Ensure Carla's createdAt is strictly earlier than Diego's in DB for deterministic oldest-queue ordering
    await db
      .update(userSchedules)
      .set({ createdAt: new Date(Date.now() - 10_000).toISOString() })
      .where(eq(userSchedules.id, carlaEnrollRes.enrollment.id))

    // 4. Assigned instructor (Sara) sends a custom email to enrolled participants (POST /api/schedules/:id/email)
    clearSentEmailsOutbox()
    const instrEmailEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/email`,
      cookies: { [SESSION_COOKIE_NAME]: instructor.cookie },
      body: { message: 'Ricordate di portare un asciugamano.' },
      d1,
    })
    await authMiddleware(instrEmailEv)
    const instrEmailRes = await scheduleEmailHandler(instrEmailEv)
    expect(instrEmailRes.success).toBe(true)
    expect(instrEmailRes.sentCount).toBe(2) // Anna & Bruno (enrolled, not queued)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toEqual(
      expect.arrayContaining(['anna@cliente.it', 'bruno@cliente.it']),
    )

    // Unassigned instructor (Luca) is blocked with 403 from emailing Sara's lesson
    const otherInstrEmailEv = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${scheduleId}/email`,
      cookies: { [SESSION_COOKIE_NAME]: otherInstructor.cookie },
      body: { message: 'Tentativo non autorizzato' },
      d1,
    })
    await authMiddleware(otherInstrEmailEv)
    await expect(scheduleEmailHandler(otherInstrEmailEv)).rejects.toMatchObject({
      statusCode: 403,
    })

    // 5. Anna (enrolled, is_queued = false) unenrolls -> Carla (oldest in queue) is atomically promoted to is_queued = false and receives promotion email!
    clearSentEmailsOutbox()
    const unenrollAnnaEv = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${scheduleId}/enroll/${cust1.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: cust1.cookie },
      d1,
    })
    await authMiddleware(unenrollAnnaEv)
    const unenrollAnnaRes = await unenrollScheduleHandler(unenrollAnnaEv)
    expect(unenrollAnnaRes.success).toBe(true)
    expect(unenrollAnnaRes.wasQueued).toBe(false)
    expect(unenrollAnnaRes.promotedUserId).toBe(cust3.user.id) // Carla promoted!
    expect(unenrollAnnaRes.schedule.enrolledCount).toBe(2) // Bruno + Carla
    expect(unenrollAnnaRes.schedule.queuedCount).toBe(1) // Diego remains in queue at position 1

    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]?.to).toBe('carla@cliente.it')
    expect(sentEmailsOutbox[0]?.subject).toContain('Posto confermato dalla coda')

    // 6. Diego (in queue, is_queued = true) unenrolls -> soft-deleted without promoting anyone
    clearSentEmailsOutbox()
    const unenrollDiegoEv = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${scheduleId}/enroll/${cust4.user.id}`,
      cookies: { [SESSION_COOKIE_NAME]: cust4.cookie },
      d1,
    })
    await authMiddleware(unenrollDiegoEv)
    const unenrollDiegoRes = await unenrollScheduleHandler(unenrollDiegoEv)
    expect(unenrollDiegoRes.wasQueued).toBe(true)
    expect(unenrollDiegoRes.promotedUserId).toBeNull()
    expect(unenrollDiegoRes.schedule.queuedCount).toBe(0)
    expect(sentEmailsOutbox).toHaveLength(0)
  })

  it('returns complete customer summary (GET /api/customer/summary) with activeSchedules, cancelledSchedules until end time, activeSubscriptions, and expiredSubscriptions', async () => {
    const { d1, db, seed, managerCookie, course } = await setupTestEnvironment()

    const customer = await createAndLoginUser(d1, managerCookie, {
      name: 'Elena',
      surname: 'Riepilogo',
      phoneNumber: '+393481234567',
      email: 'elena.summary@cliente.it',
    })

    const nowMs = Date.now()
    const pastCreatedIso = new Date(nowMs - 10 * 24 * 60 * 60_000).toISOString()

    // Create subscription template
    const createSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Abbonamento Yoga',
        entrances: 10,
        durationDays: 30,
        classIds: [course.id],
      },
      d1,
    })
    await authMiddleware(createSubEv)
    const subTemplate = (await createSubscriptionHandler(createSubEv)).subscription

    // 1. Active subscription for Elena
    const createActiveSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: customer.user.id,
        subscriptionId: subTemplate.id,
        startDate: new Date(nowMs - 2 * 24 * 60 * 60_000).toISOString(),
      },
      d1,
    })
    await authMiddleware(createActiveSubEv)
    const activeUserSub = (await createUserSubscriptionHandler(createActiveSubEv)).userSubscription

    // 2. Expired subscription for Elena (started 40 days ago, duration 30 days -> expired 10 days ago)
    const createExpiredSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: customer.user.id,
        subscriptionId: subTemplate.id,
        startDate: new Date(nowMs - 40 * 24 * 60 * 60_000).toISOString(),
      },
      d1,
    })
    await authMiddleware(createExpiredSubEv)
    const expiredUserSub = (await createUserSubscriptionHandler(createExpiredSubEv))
      .userSubscription

    // Create 4 schedules where Elena is enrolled:
    // A) ENROLLING future schedule (in 2 days) -> in activeSchedules
    // B) CANCELLED_LOW_ENROLLMENT schedule whose end time is in the future (starts in 10 mins, registration closed 20 mins ago, enrolled 1 < min 3) -> in cancelledSchedules
    // C) CANCELLED_BY_PROVIDER schedule whose end time is in the future (in 3 hours) -> in cancelledSchedules
    // D) CANCELLED_BY_PROVIDER schedule whose end time was Yesterday -> NOT in cancelledSchedules
    const schedEnrollingId = uuidv7()
    const schedCancelledLowId = uuidv7()
    const schedCancelledFutureId = uuidv7()
    const schedCancelledPastId = uuidv7()

    await db.insert(schedules).values([
      {
        id: schedEnrollingId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs + 2 * 24 * 60 * 60_000).toISOString(),
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 30,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
      {
        id: schedCancelledLowId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs + 10 * 60_000).toISOString(),
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 3, // requires 3, only Elena is enrolled -> CANCELLED_LOW_ENROLLMENT
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 30, // closed 20 mins ago
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
      {
        id: schedCancelledFutureId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs + 3 * 60 * 60_000).toISOString(),
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: null,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
        deletedAt: new Date(nowMs - 60_000).toISOString(), // CANCELLED_BY_PROVIDER
      },
      {
        id: schedCancelledPastId,
        classId: course.id,
        centerId: seed.centerId,
        instructorId: null,
        startDate: new Date(nowMs - 24 * 60 * 60_000).toISOString(), // Yesterday (endDate < now)
        durationMinutes: 60,
        availableSpots: 10,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: null,
        createdBy: seed.managerId,
        updatedBy: seed.managerId,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
        deletedAt: new Date(nowMs - 25 * 60 * 60_000).toISOString(), // CANCELLED_BY_PROVIDER in the past
      },
    ])

    await db.insert(userSchedules).values([
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: schedEnrollingId,
        userSubscriptionId: activeUserSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: schedCancelledLowId,
        userSubscriptionId: activeUserSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: schedCancelledFutureId,
        userSubscriptionId: activeUserSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
      {
        id: uuidv7(),
        centerId: seed.centerId,
        userId: customer.user.id,
        scheduleId: schedCancelledPastId,
        userSubscriptionId: activeUserSub.id,
        isQueued: false,
        createdBy: customer.user.id,
        updatedBy: customer.user.id,
        createdAt: pastCreatedIso,
        updatedAt: pastCreatedIso,
      },
    ])

    const summaryEv = createTestH3Event({
      method: 'GET',
      url: '/api/customer/summary',
      cookies: { [SESSION_COOKIE_NAME]: customer.cookie },
      d1,
    })
    await authMiddleware(summaryEv)
    const summaryRes = await customerSummaryHandler(summaryEv)

    // Verify activeSchedules
    expect(summaryRes.activeSchedules).toHaveLength(1)
    expect(summaryRes.activeSchedules[0]?.id).toBe(schedEnrollingId)
    expect(summaryRes.activeSchedules[0]?.status).toBe('ENROLLING')
    expect(summaryRes.activeSchedules[0]?.customerStatusLabel).toBe('Iscritto')

    // Verify cancelledSchedules (includes both CANCELLED_LOW_ENROLLMENT and future CANCELLED_BY_PROVIDER, excludes past CANCELLED_BY_PROVIDER)
    expect(summaryRes.cancelledSchedules).toHaveLength(2)
    expect(summaryRes.cancelledSchedules.map((s) => s.id)).toEqual([
      schedCancelledLowId,
      schedCancelledFutureId,
    ])
    expect(summaryRes.cancelledSchedules[0]?.customerStatusLabel).toBe(
      'Annullato per numero minimo non raggiunto',
    )
    expect(summaryRes.cancelledSchedules[1]?.customerStatusLabel).toBe('Annullato dal gerente')

    // Verify activeSubscriptions & expiredSubscriptions
    expect(summaryRes.activeSubscriptions).toHaveLength(1)
    expect(summaryRes.activeSubscriptions[0]?.id).toBe(activeUserSub.id)
    // Only schedEnrollingId consumes an entrance; the 3 cancelled schedules do NOT consume entrances!
    expect(summaryRes.activeSubscriptions[0]?.usedEntrances).toBe(1)
    expect(summaryRes.activeSubscriptions[0]?.remainingEntrances).toBe(9)

    expect(summaryRes.expiredSubscriptions).toHaveLength(1)
    expect(summaryRes.expiredSubscriptions[0]?.id).toBe(expiredUserSub.id)
    expect(summaryRes.expiredSubscriptions[0]?.isActive).toBe(false)
  })
})

