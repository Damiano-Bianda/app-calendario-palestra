import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler, readBody } from 'h3'
import { uuidv7 } from 'uuidv7'
import { enrollScheduleSchema } from '../../../../shared/schemas/schedules.ts'
import {
  selectBestUserSubscriptionForSchedule,
  type CandidateUserSubscription,
} from '../../../../shared/utils/subscription-entrances.ts'
import {
  classes,
  schedules,
  subscriptions,
  subscriptionsClasses,
  userSchedules,
  users,
  usersCenters,
  usersSubscriptions,
} from '../../../db/schema.ts'
import {
  requireAuth,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../../utils/auth.ts'
import { useDb } from '../../../utils/db.ts'
import {
  attachComputedScheduleMetrics,
  attachComputedUserSubscriptionMetrics,
  enrichSchedulesForResponse,
} from '../../../utils/domain-queries.ts'
import { sendManagerEnrollmentEmail } from '../../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const scheduleId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const rawBody = await readBody(event).catch(() => ({}))
  const parsedBody = enrollScheduleSchema.safeParse(rawBody ?? {})
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      message: parsedBody.error.issues[0]?.message ?? 'Parametri di iscrizione non validi.',
    })
  }

  const requestedUserId = parsedBody.data.userId
  if (requestedUserId && requestedUserId !== auth.userId) {
    requireManagerOrAssistant(event)
  }

  const targetUserId = requestedUserId ?? auth.userId
  const enrolledByManager =
    (auth.isManager || auth.isAssistantManager) &&
    Boolean(requestedUserId) &&
    targetUserId !== auth.userId

  // 1. Verify target user belongs to the active center and is active
  const targetUserRows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: usersCenters.name,
      surname: usersCenters.surname,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.centerId, auth.centerId),
        eq(usersCenters.userId, targetUserId),
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const targetUser = targetUserRows[0]
  if (!targetUser) {
    throw createError({
      statusCode: 404,
      message: 'Cliente non trovato o non abilitato nella sede attiva.',
    })
  }

  // 2. Fetch the schedule and compute its current status & enrollment metrics
  const scheduleRow = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), eq(schedules.centerId, auth.centerId)),
  })

  if (!scheduleRow) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  const [scheduleWithMetrics] = await attachComputedScheduleMetrics(db, [scheduleRow], now)
  if (!scheduleWithMetrics || scheduleWithMetrics.status !== 'ENROLLING') {
    throw createError({
      statusCode: 409,
      message: `Impossibile iscriversi: le iscrizioni per questa lezione non sono aperte (stato attuale: ${scheduleWithMetrics?.status ?? 'SCONOSCIUTO'}).`,
    })
  }

  // Check if user is already enrolled or queued for this lesson
  const alreadyEnrolled = scheduleWithMetrics.activeUserSchedules.some(
    (r) => r.userId === targetUserId,
  )
  if (alreadyEnrolled) {
    throw createError({
      statusCode: 409,
      message: "L'utente è già iscritto o in coda per questa lezione.",
    })
  }

  // 3. Find all active user subscriptions for targetUserId in this center and select the one expiring soonest
  const rawUserSubs = await db
    .select({
      userSub: usersSubscriptions,
    })
    .from(usersSubscriptions)
    .innerJoin(subscriptions, eq(usersSubscriptions.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(usersSubscriptions.centerId, auth.centerId),
        eq(usersSubscriptions.userId, targetUserId),
        isNull(usersSubscriptions.deletedAt),
        isNull(subscriptions.deletedAt),
      ),
    )

  const userSubRows = rawUserSubs.map((r) => r.userSub)
  const computedUserSubs = await attachComputedUserSubscriptionMetrics(db, userSubRows, now)

  const templateIds = Array.from(new Set(userSubRows.map((s) => s.subscriptionId)))
  const subClassesRows =
    templateIds.length > 0
      ? await db
          .select({
            subscriptionId: subscriptionsClasses.subscriptionId,
            classId: subscriptionsClasses.classId,
          })
          .from(subscriptionsClasses)
          .where(
            and(
              inArray(subscriptionsClasses.subscriptionId, templateIds),
              isNull(subscriptionsClasses.deletedAt),
            ),
          )
      : []

  const classIdsByTemplateId = new Map<string, string[]>()
  for (const sc of subClassesRows) {
    const list = classIdsByTemplateId.get(sc.subscriptionId)
    if (list) {
      list.push(sc.classId)
    } else {
      classIdsByTemplateId.set(sc.subscriptionId, [sc.classId])
    }
  }

  const candidates: CandidateUserSubscription[] = computedUserSubs
    .filter((sub) => sub.isActive)
    .map((sub) => ({
      id: sub.id,
      startDate: sub.startDate,
      endDate: sub.endDate,
      entrances: sub.entrances,
      remainingEntrances: sub.remainingEntrances,
      enabledClassIds: classIdsByTemplateId.get(sub.subscriptionId) ?? [],
      deletedAt: sub.deletedAt,
      createdAt: sub.createdAt,
    }))

  const bestSubscription = selectBestUserSubscriptionForSchedule(
    candidates,
    scheduleRow.classId,
    scheduleRow.startDate,
  )

  if (!bestSubscription) {
    throw createError({
      statusCode: 409,
      message:
        "Nessuna sottoscrizione d'abbonamento attiva e valida con ingressi disponibili per questo corso nella data della lezione.",
    })
  }

  // 4. Check if lesson is full -> queue if full, enroll directly otherwise
  const isFull =
    scheduleRow.availableSpots !== null &&
    scheduleWithMetrics.enrolledCount >= scheduleRow.availableSpots
  const isQueued = isFull

  const newEnrollment = {
    id: uuidv7(),
    centerId: auth.centerId,
    userId: targetUserId,
    scheduleId: scheduleRow.id,
    userSubscriptionId: bestSubscription.id,
    isQueued,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  try {
    await db.batch([db.insert(userSchedules).values(newEnrollment)])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE') || msg.includes('user_schedules_schedule_user_active_idx')) {
      throw createError({
        statusCode: 409,
        message: "L'utente è già iscritto o in coda per questa lezione.",
      })
    }
    throw err
  }

  // 5. If enrolled by Manager / Assistant Manager, notify customer via email (SPECIFICATION.md line 201, 471)
  if (enrolledByManager) {
    const course = await db.query.classes.findFirst({
      where: eq(classes.id, scheduleRow.classId),
    })

    await sendManagerEnrollmentEmail(event, {
      to: targetUser.email,
      name: targetUser.name,
      surname: targetUser.surname,
      centerName: auth.centerName,
      timezone: auth.timezone,
      className: course?.name ?? 'Corso',
      startDate: scheduleRow.startDate,
      durationMinutes: scheduleRow.durationMinutes,
      isQueued,
    })
  }

  const [enrichedSchedule] = await enrichSchedulesForResponse(db, [scheduleRow], {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  return {
    enrollment: newEnrollment,
    isQueued,
    selectedSubscriptionId: bestSubscription.id,
    notifiedCustomer: enrolledByManager,
    schedule: enrichedSchedule!,
  }
})

