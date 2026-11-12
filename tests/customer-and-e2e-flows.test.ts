import { uuidv7 } from 'uuidv7'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addDaysToLocalDate,
  canNavigateToPreviousCustomerDay,
  formatCustomerSpotsLabel,
  formatLocalDateHeaderIt,
  getCustomerStatusBadgeClass,
  getTodayInCenterTimezone,
} from '../app/utils/ui-formatters'
import loginHandler from '../server/api/auth/login.post'
import logoutHandler from '../server/api/auth/logout.post'
import meHandler from '../server/api/auth/me.get'
import recoverHandler from '../server/api/auth/recover.post'
import resetPasswordHandler from '../server/api/auth/reset-password.post'
import createClassHandler from '../server/api/classes/index.post'
import customerSummaryHandler from '../server/api/customer/summary.get'
import deleteScheduleHandler from '../server/api/schedules/[id].delete'
import enrollScheduleHandler from '../server/api/schedules/[id]/enroll.post'
import unenrollScheduleHandler from '../server/api/schedules/[id]/enroll/[userId].delete'
import listSchedulesHandler from '../server/api/schedules/index.get'
import createSchedulesHandler from '../server/api/schedules/index.post'
import changeCenterHandler from '../server/api/settings/center.put'
import changePasswordHandler from '../server/api/settings/password.put'
import createSubscriptionHandler from '../server/api/subscriptions/index.post'
import createUserSubscriptionHandler from '../server/api/user-subscriptions/index.post'
import createUserHandler from '../server/api/users/index.post'
import { centers, usersCenters } from '../server/db/schema'
import { seedDatabase } from '../server/db/seed'
import authMiddleware from '../server/middleware/auth'
import { SESSION_COOKIE_NAME } from '../server/utils/auth'
import { createDb } from '../server/utils/db'
import { clearSentEmailsOutbox, sentEmailsOutbox } from '../server/utils/email'
import { formatCenterTimeRange, utcIsoToLocalParts } from '../shared/utils/timezone'
import {
  createInMemorySqliteWithMigrations,
  createMockD1Database,
  createTestH3Event,
  extractSetCookieValue,
} from './helpers/mock-d1'

describe('Step 7: Customer UI Helpers, 4-Row Course Card & End-to-End Flows', () => {
  beforeEach(() => {
    clearSentEmailsOutbox()
  })

  it('formats 4-row UserCourseCard spots label and status badges accurately (SPECIFICATION.md line 390)', () => {
    // Row 1 right: X posti liberi su Y or Completo or Posti illimitati
    expect(formatCustomerSpotsLabel(null, null)).toBe('Posti illimitati')
    expect(formatCustomerSpotsLabel(15, 5)).toBe('5 posti liberi su 15')
    expect(formatCustomerSpotsLabel(10, 0)).toBe('Completo')
    expect(formatCustomerSpotsLabel(10, -1)).toBe('Completo')

    // Row 2 right: status badge styles
    expect(
      getCustomerStatusBadgeClass('ENROLLING', { isEnrolled: false, isQueued: false }),
    ).toContain('bg-emerald-100')
    expect(
      getCustomerStatusBadgeClass('ENROLLING', { isEnrolled: true, isQueued: false }),
    ).toContain('bg-emerald-600')
    expect(
      getCustomerStatusBadgeClass('ENROLLING', { isEnrolled: false, isQueued: true }),
    ).toContain('bg-amber-100')
    expect(
      getCustomerStatusBadgeClass('UPCOMING', { isEnrolled: true, isQueued: false }),
    ).toContain('bg-indigo-600')
    expect(
      getCustomerStatusBadgeClass('UPCOMING', { isEnrolled: false, isQueued: false }),
    ).toContain('bg-slate-100')
    expect(
      getCustomerStatusBadgeClass('CANCELLED_LOW_ENROLLMENT', {
        isEnrolled: true,
        isQueued: false,
      }),
    ).toContain('bg-rose-100')
    expect(
      getCustomerStatusBadgeClass('CANCELLED_BY_PROVIDER', {
        isEnrolled: true,
        isQueued: false,
      }),
    ).toContain('bg-red-100')
  })

  it('enforces Customer Dashboard daily navigation rules (no past days, anchored to center.timezone)', () => {
    const today = '2026-11-12'
    expect(canNavigateToPreviousCustomerDay('2026-11-12', today)).toBe(false)
    expect(canNavigateToPreviousCustomerDay('2026-11-11', today)).toBe(false)
    expect(canNavigateToPreviousCustomerDay('2026-11-13', today)).toBe(true)

    expect(addDaysToLocalDate('2026-11-12', 1)).toBe('2026-11-13')
    expect(addDaysToLocalDate('2026-11-13', -1)).toBe('2026-11-12')
    expect(addDaysToLocalDate('2026-11-30', 1)).toBe('2026-12-01')

    const headerIt = formatLocalDateHeaderIt('2026-11-12', 'Europe/Rome')
    expect(headerIt.toLowerCase()).toContain('giovedì')
    expect(headerIt.toLowerCase()).toContain('12')
    expect(headerIt.toLowerCase()).toContain('novembre')
    expect(headerIt).toContain('2026')
  })

  it('verifies end-to-end flow: Login -> Password Recovery (/recover) -> Settings (/settings) -> Customer Dashboard (/customer) -> Summary (/customer/summary) -> Logout', async () => {
    const sqlite = createInMemorySqliteWithMigrations()
    const d1 = createMockD1Database(sqlite)
    const db = createDb(d1)
    const seed = await seedDatabase(db)

    // 1. Login as Manager -> redirects to /worker
    const managerLoginEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'gerente@palestra.it', password: 'Gerente123!' },
      d1,
    })
    const managerLoginRes = await loginHandler(managerLoginEv)
    expect(managerLoginRes.defaultMode).toBe('worker')
    expect(managerLoginRes.defaultRedirect).toBe('/worker')
    const managerCookie = extractSetCookieValue(managerLoginEv, SESSION_COOKIE_NAME)!

    // 2. Manager creates an Instructor and two Customers
    async function createUserAndExtractPassword(params: {
      name: string
      surname: string
      phoneNumber: string
      email: string
      isInstructor?: boolean
    }) {
      clearSentEmailsOutbox()
      const ev = createTestH3Event({
        method: 'POST',
        url: '/api/users',
        cookies: { [SESSION_COOKIE_NAME]: managerCookie },
        body: params,
        d1,
      })
      await authMiddleware(ev)
      const res = await createUserHandler(ev)
      const tempPassword = sentEmailsOutbox[0]!.text.match(/Password temporanea:\s*(\S+)/)![1]!
      clearSentEmailsOutbox()
      return { user: res.user, password: tempPassword }
    }

    const instructor = await createUserAndExtractPassword({
      name: 'Elena',
      surname: 'Bianchi',
      phoneNumber: '+393331112233',
      email: 'elena.istruttore@palestra.it',
      isInstructor: true,
    })
    const customer1 = await createUserAndExtractPassword({
      name: 'Luca',
      surname: 'Verdi',
      phoneNumber: '+393334445566',
      email: 'luca.cliente@palestra.it',
    })
    const customer2 = await createUserAndExtractPassword({
      name: 'Sara',
      surname: 'Neri',
      phoneNumber: '+393337778899',
      email: 'sara.cliente@palestra.it',
    })

    // 3. Instructor logs in -> defaultRedirect is /worker/calendar
    const instrLoginEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: instructor.user.email, password: instructor.password },
      d1,
    })
    const instrLoginRes = await loginHandler(instrLoginEv)
    expect(instrLoginRes.defaultMode).toBe('worker')
    expect(instrLoginRes.defaultRedirect).toBe('/worker/calendar')

    // 4. Customer 1 uses /recover flow (request recovery link -> reset password -> login)
    clearSentEmailsOutbox()
    const recoverEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/recover',
      body: { email: customer1.user.email },
      d1,
    })
    const recoverRes = await recoverHandler(recoverEv)
    expect(recoverRes.success).toBe(true)
    expect(sentEmailsOutbox).toHaveLength(1)
    const tokenMatch = sentEmailsOutbox[0]!.text.match(/token=([^\s&]+)/)
    expect(tokenMatch).not.toBeNull()
    const recoveryToken = decodeURIComponent(tokenMatch![1]!)

    const resetEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/reset-password',
      body: { token: recoveryToken, newPassword: 'NuovaPasswordCliente1!' },
      d1,
    })
    const resetRes = await resetPasswordHandler(resetEv)
    expect(resetRes.success).toBe(true)

    // Customer 1 logs in with the new password -> defaultRedirect is /customer
    const cust1LoginEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: customer1.user.email, password: 'NuovaPasswordCliente1!' },
      d1,
    })
    const cust1LoginRes = await loginHandler(cust1LoginEv)
    expect(cust1LoginRes.defaultMode).toBe('customer')
    expect(cust1LoginRes.defaultRedirect).toBe('/customer')
    let cust1Cookie = extractSetCookieValue(cust1LoginEv, SESSION_COOKIE_NAME)!

    // Customer 2 logs in
    const cust2LoginEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: customer2.user.email, password: customer2.password },
      d1,
    })
    await loginHandler(cust2LoginEv)
    const cust2Cookie = extractSetCookieValue(cust2LoginEv, SESSION_COOKIE_NAME)!

    // 5. Settings flow (/settings): Customer 1 belongs to a second center and switches between them, and updates password
    const secondCenterId = uuidv7()
    const nowIso = new Date().toISOString()
    await db.insert(centers).values({
      id: secondCenterId,
      name: 'Palestra Milano Nord',
      timezone: 'Europe/Rome',
      createdBy: seed.adminId,
      updatedBy: seed.adminId,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    })
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId: secondCenterId,
      userId: customer1.user.id,
      name: 'Luca',
      surname: 'Verdi',
      phoneNumber: '+393334445566',
      isManager: false,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: seed.managerId,
      updatedBy: seed.managerId,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    })

    // Switch to second center
    const switchToCenter2Ev = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/center',
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      body: { centerId: secondCenterId },
      d1,
    })
    await authMiddleware(switchToCenter2Ev)
    const switchRes2 = await changeCenterHandler(switchToCenter2Ev)
    expect(switchRes2.activeCenterId).toBe(secondCenterId)
    cust1Cookie = extractSetCookieValue(switchToCenter2Ev, SESSION_COOKIE_NAME)!

    // Switch back to main center
    const switchBackEv = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/center',
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      body: { centerId: seed.centerId },
      d1,
    })
    await authMiddleware(switchBackEv)
    const switchBackRes = await changeCenterHandler(switchBackEv)
    expect(switchBackRes.activeCenterId).toBe(seed.centerId)
    cust1Cookie = extractSetCookieValue(switchBackEv, SESSION_COOKIE_NAME)!

    // Change password in /settings
    const changePassEv = createTestH3Event({
      method: 'PUT',
      url: '/api/settings/password',
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      body: {
        currentPassword: 'NuovaPasswordCliente1!',
        newPassword: 'PasswordDefinitiva99!',
      },
      d1,
    })
    await authMiddleware(changePassEv)
    const changePassRes = await changePasswordHandler(changePassEv)
    expect(changePassRes.success).toBe(true)

    // 6. Manager creates Course, Subscription Template, and User Subscriptions for Customer 1 & Customer 2
    const createCourseEv = createTestH3Event({
      method: 'POST',
      url: '/api/classes',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Pilates Reformer',
        color: 'cyan',
        description: 'Allenamento posturale su Reformer',
      },
      d1,
    })
    await authMiddleware(createCourseEv)
    const pilatesClass = (await createClassHandler(createCourseEv)).class

    const createSubEv = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Carnet 5 Pilates',
        description: 'Valido 30 giorni per Pilates Reformer',
        entrances: 5,
        durationDays: 30,
        classIds: [pilatesClass.id],
      },
      d1,
    })
    await authMiddleware(createSubEv)
    const subTemplate = (await createSubscriptionHandler(createSubEv)).subscription

    const subStartIso = new Date(Date.now() - 86_400_000).toISOString()
    for (const cust of [customer1, customer2]) {
      const assignEv = createTestH3Event({
        method: 'POST',
        url: '/api/user-subscriptions',
        cookies: { [SESSION_COOKIE_NAME]: managerCookie },
        body: {
          userId: cust.user.id,
          subscriptionId: subTemplate.id,
          startDate: subStartIso,
        },
        d1,
      })
      await authMiddleware(assignEv)
      await createUserSubscriptionHandler(assignEv)
    }

    // Also create an already-expired user subscription for Customer 1 to verify /customer/summary expired list
    const expiredSubTemplateEv = createTestH3Event({
      method: 'POST',
      url: '/api/subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        name: 'Ingresso Singolo Promo',
        description: 'Abbonamento promo',
        entrances: 1,
        durationDays: 1,
        classIds: [pilatesClass.id],
      },
      d1,
    })
    await authMiddleware(expiredSubTemplateEv)
    const expiredTemplate = (await createSubscriptionHandler(expiredSubTemplateEv)).subscription

    const pastStartIso = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const assignExpiredEv = createTestH3Event({
      method: 'POST',
      url: '/api/user-subscriptions',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        userId: customer1.user.id,
        subscriptionId: expiredTemplate.id,
        startDate: pastStartIso,
      },
      d1,
    })
    await authMiddleware(assignExpiredEv)
    await createUserSubscriptionHandler(assignExpiredEv)

    // 7. Manager creates 2 lessons tomorrow (in center timezone Europe/Rome) and 1 DRAFT lesson
    const todayInRome = getTodayInCenterTimezone('Europe/Rome')
    const tomorrowInRome = addDaysToLocalDate(todayInRome, 1)
    const tomorrowParts = utcIsoToLocalParts(
      new Date(Date.now() + 86_400_000).toISOString(),
      'Europe/Rome',
    )

    // Lesson A: 10:00 (1 spot available, immediately published and enrolling)
    const createLessonAEv = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: pilatesClass.id,
        instructorId: instructor.user.id,
        rangeStartDate: tomorrowParts.date,
        rangeEndDate: tomorrowParts.date,
        daysOfWeek: [tomorrowParts.weekday],
        startTime: '10:00',
        durationMinutes: 60,
        availableSpots: 1,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 30,
      },
      d1,
    })
    await authMiddleware(createLessonAEv)
    const lessonA = (await createSchedulesHandler(createLessonAEv)).schedules[0]!

    // Lesson B: 18:00 (2 spots available, will be cancelled by manager after Customer 1 enrolls)
    const createLessonBEv = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: pilatesClass.id,
        instructorId: instructor.user.id,
        rangeStartDate: tomorrowParts.date,
        rangeEndDate: tomorrowParts.date,
        daysOfWeek: [tomorrowParts.weekday],
        startTime: '18:00',
        durationMinutes: 45,
        availableSpots: 2,
        minimumSpots: 1,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 30,
      },
      d1,
    })
    await authMiddleware(createLessonBEv)
    const lessonB = (await createSchedulesHandler(createLessonBEv)).schedules[0]!

    // Lesson C (DRAFT): published 5 minutes before start -> currently in DRAFT status
    const createLessonDraftEv = createTestH3Event({
      method: 'POST',
      url: '/api/schedules',
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: {
        classId: pilatesClass.id,
        instructorId: instructor.user.id,
        rangeStartDate: tomorrowParts.date,
        rangeEndDate: tomorrowParts.date,
        daysOfWeek: [tomorrowParts.weekday],
        startTime: '20:00',
        durationMinutes: 50,
        availableSpots: 5,
        minimumSpots: 1,
        publicationMinutesBefore: 60,
        registrationOpenMinutesBefore: 30,
        registrationCloseMinutesBefore: 10,
      },
      d1,
    })
    await authMiddleware(createLessonDraftEv)
    await createSchedulesHandler(createLessonDraftEv)

    // 8. Customer 1 opens /customer for tomorrow: sees Lesson A and Lesson B (DRAFT Lesson C is excluded!)
    const listCustomerDayEv = createTestH3Event({
      method: 'GET',
      url: `/api/schedules?date=${tomorrowInRome}&view=day&mode=customer`,
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      d1,
    })
    await authMiddleware(listCustomerDayEv)
    const dayRes = await listSchedulesHandler(listCustomerDayEv)
    expect(dayRes.schedules).toHaveLength(2)

    const cardA = dayRes.schedules.find((s) => s.id === lessonA.id)!
    // Verify all 4 rows of the UserCourseCard data for Lesson A:
    // Row 1: time & duration + spots
    expect(formatCenterTimeRange(cardA.startDate, cardA.durationMinutes, 'Europe/Rome')).toBe(
      '10:00 - 11:00',
    )
    expect(formatCustomerSpotsLabel(cardA.availableSpots, cardA.remainingSpots)).toBe(
      '1 posti liberi su 1',
    )
    // Row 2: class name + customerStatusLabel
    expect(cardA.class?.name).toBe('Pilates Reformer')
    expect(cardA.customerStatusLabel).toBe('Iscrizioni aperte')
    // Row 3: instructor name
    expect(`${cardA.instructor?.name} ${cardA.instructor?.surname}`).toBe('Elena Bianchi')
    // Row 4: required subscriptions + action state
    expect(cardA.requiredSubscriptions.map((s) => s.name)).toContain('Carnet 5 Pilates')
    expect(cardA.userEnrollment.isEnrolled).toBe(false)

    // 9. Customer 1 enrolls in Lesson A and Lesson B
    const enrollA1Ev = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${lessonA.id}/enroll`,
      params: { id: lessonA.id },
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollA1Ev)
    const enrollA1Res = await enrollScheduleHandler(enrollA1Ev)
    expect(enrollA1Res.isQueued).toBe(false)
    expect(enrollA1Res.schedule.customerStatusLabel).toBe('Iscritto')
    expect(
      formatCustomerSpotsLabel(
        enrollA1Res.schedule.availableSpots,
        enrollA1Res.schedule.remainingSpots,
      ),
    ).toBe('Completo')

    const enrollB1Ev = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${lessonB.id}/enroll`,
      params: { id: lessonB.id },
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollB1Ev)
    await enrollScheduleHandler(enrollB1Ev)

    // 10. Customer 2 enrolls in full Lesson A -> placed in queue!
    const enrollA2Ev = createTestH3Event({
      method: 'POST',
      url: `/api/schedules/${lessonA.id}/enroll`,
      params: { id: lessonA.id },
      cookies: { [SESSION_COOKIE_NAME]: cust2Cookie },
      body: {},
      d1,
    })
    await authMiddleware(enrollA2Ev)
    const enrollA2Res = await enrollScheduleHandler(enrollA2Ev)
    expect(enrollA2Res.isQueued).toBe(true)
    expect(enrollA2Res.schedule.customerStatusLabel).toBe('Coda')
    expect(enrollA2Res.schedule.userEnrollment.queuePosition).toBe(1)

    // 11. Manager cancels Lesson B -> status becomes CANCELLED_BY_PROVIDER and entrance is refunded to Customer 1
    const cancelBEv = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${lessonB.id}`,
      params: { id: lessonB.id },
      cookies: { [SESSION_COOKIE_NAME]: managerCookie },
      body: { notifyEnrolled: true, notificationMessage: 'Istruttore indisposto' },
      d1,
    })
    await authMiddleware(cancelBEv)
    await deleteScheduleHandler(cancelBEv)

    // 12. Customer 1 checks /customer/summary:
    // - activeSchedules has Lesson A (1 consumed entrance)
    // - cancelledSchedules has Lesson B (status CANCELLED_BY_PROVIDER, customerStatusLabel "Annullato dal gerente")
    // - activeSubscriptions has Carnet 5 Pilates with 4 remaining entrances out of 5
    // - expiredSubscriptions has Ingresso Singolo Promo
    const summary1Ev = createTestH3Event({
      method: 'GET',
      url: '/api/customer/summary',
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      d1,
    })
    await authMiddleware(summary1Ev)
    const summary1Res = await customerSummaryHandler(summary1Ev)

    expect(summary1Res.activeSchedules).toHaveLength(1)
    expect(summary1Res.activeSchedules[0]!.id).toBe(lessonA.id)
    expect(summary1Res.activeSchedules[0]!.customerStatusLabel).toBe('Iscritto')

    expect(summary1Res.cancelledSchedules).toHaveLength(1)
    expect(summary1Res.cancelledSchedules[0]!.id).toBe(lessonB.id)
    expect(summary1Res.cancelledSchedules[0]!.customerStatusLabel).toBe('Annullato dal gerente')

    expect(summary1Res.activeSubscriptions).toHaveLength(1)
    expect(summary1Res.activeSubscriptions[0]!.subscription.name).toBe('Carnet 5 Pilates')
    expect(summary1Res.activeSubscriptions[0]!.remainingEntrances).toBe(4)

    expect(summary1Res.expiredSubscriptions).toHaveLength(1)
    expect(summary1Res.expiredSubscriptions[0]!.subscription.name).toBe('Ingresso Singolo Promo')

    // 13. Customer 1 unenrolls from Lesson A -> Customer 2 is promoted from queue and notified by email!
    clearSentEmailsOutbox()
    const unenrollA1Ev = createTestH3Event({
      method: 'DELETE',
      url: `/api/schedules/${lessonA.id}/enroll/${customer1.user.id}`,
      params: { id: lessonA.id, userId: customer1.user.id },
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      d1,
    })
    await authMiddleware(unenrollA1Ev)
    const unenrollA1Res = await unenrollScheduleHandler(unenrollA1Ev)
    expect(unenrollA1Res.promotedUserId).toBe(customer2.user.id)
    expect(sentEmailsOutbox).toHaveLength(1)
    expect(sentEmailsOutbox[0]!.to).toBe(customer2.user.email)

    // Customer 2's summary now shows Lesson A as enrolled ("Iscritto", not "Coda")
    const summary2Ev = createTestH3Event({
      method: 'GET',
      url: '/api/customer/summary',
      cookies: { [SESSION_COOKIE_NAME]: cust2Cookie },
      d1,
    })
    await authMiddleware(summary2Ev)
    const summary2Res = await customerSummaryHandler(summary2Ev)
    expect(summary2Res.activeSchedules).toHaveLength(1)
    expect(summary2Res.activeSchedules[0]!.userEnrollment.isEnrolled).toBe(true)
    expect(summary2Res.activeSchedules[0]!.userEnrollment.isQueued).toBe(false)
    expect(summary2Res.activeSchedules[0]!.customerStatusLabel).toBe('Iscritto')

    // 14. Customer 1 logs out via POST /api/auth/logout -> session cleared
    const logoutEv = createTestH3Event({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE_NAME]: cust1Cookie },
      d1,
    })
    const logoutRes = await logoutHandler(logoutEv)
    expect(logoutRes.success).toBe(true)

    const meAfterLogoutEv = createTestH3Event({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {},
      d1,
    })
    await expect(meHandler(meAfterLogoutEv)).rejects.toThrow()
  })
})

