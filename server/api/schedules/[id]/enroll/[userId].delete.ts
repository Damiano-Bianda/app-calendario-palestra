import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { classes, schedules, userSchedules, users, usersCenters } from '../../../../db/schema.ts'
import {
  requireAuth,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../../../utils/auth.ts'
import { useDb } from '../../../../utils/db.ts'
import {
  attachComputedScheduleMetrics,
  enrichSchedulesForResponse,
} from '../../../../utils/domain-queries.ts'
import { sendQueuePromotionEmail } from '../../../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const scheduleId = requireUuidParam(event, 'id')
  const targetUserId = requireUuidParam(event, 'userId')
  const db = useDb(event)
  const now = new Date().toISOString()

  if (targetUserId !== auth.userId) {
    requireManagerOrAssistant(event)
  }

  // 1. Fetch schedule and compute current status & active enrollments
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
      message: `Impossibile disiscriversi: le iscrizioni per questa lezione non sono aperte (stato attuale: ${scheduleWithMetrics?.status ?? 'SCONOSCIUTO'}).`,
    })
  }

  // 2. Find target user's active enrollment/queue row
  const targetEnrollment = scheduleWithMetrics.activeUserSchedules.find(
    (r) => r.userId === targetUserId,
  )

  if (!targetEnrollment) {
    throw createError({
      statusCode: 404,
      message: 'Iscrizione non trovata per questa lezione.',
    })
  }

  // 3. If the unenrolled user was NOT in queue (is_queued = false), find the oldest queued registration
  const sortedQueue = scheduleWithMetrics.activeUserSchedules
    .filter((r) => r.isQueued)
    .sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt)
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
    })

  const promotedEnrollment = !targetEnrollment.isQueued ? (sortedQueue[0] ?? null) : null

  // 4. Execute soft-delete and optional queue promotion in a single atomic D1 batch
  const softDeleteStmt = db
    .update(userSchedules)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(and(eq(userSchedules.id, targetEnrollment.id), isNull(userSchedules.deletedAt)))

  if (promotedEnrollment) {
    const promoteStmt = db
      .update(userSchedules)
      .set({
        isQueued: false,
        updatedAt: now,
        updatedBy: auth.userId,
      })
      .where(
        and(
          eq(userSchedules.id, promotedEnrollment.id),
          isNull(userSchedules.deletedAt),
          eq(userSchedules.isQueued, true),
        ),
      )

    await db.batch([softDeleteStmt, promoteStmt])
  } else {
    await db.batch([softDeleteStmt])
  }

  // 5. Send queue promotion confirmation email in Italian if a queued user was promoted (SPECIFICATION.md line 210, 472)
  if (promotedEnrollment) {
    const promotedUserRows = await db
      .select({
        email: users.email,
        name: usersCenters.name,
        surname: usersCenters.surname,
      })
      .from(usersCenters)
      .innerJoin(users, eq(usersCenters.userId, users.id))
      .where(
        and(
          eq(usersCenters.centerId, auth.centerId),
          eq(usersCenters.userId, promotedEnrollment.userId),
          isNull(usersCenters.deletedAt),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)

    const promotedUser = promotedUserRows[0]
    if (promotedUser) {
      const course = await db.query.classes.findFirst({
        where: eq(classes.id, scheduleRow.classId),
      })

      await sendQueuePromotionEmail(event, {
        to: promotedUser.email,
        name: promotedUser.name,
        surname: promotedUser.surname,
        centerName: auth.centerName,
        timezone: auth.timezone,
        className: course?.name ?? 'Corso',
        startDate: scheduleRow.startDate,
        durationMinutes: scheduleRow.durationMinutes,
      })
    }
  }

  const [enrichedSchedule] = await enrichSchedulesForResponse(db, [scheduleRow], {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  return {
    success: true,
    unenrolledUserId: targetUserId,
    wasQueued: targetEnrollment.isQueued,
    promotedUserId: promotedEnrollment?.userId ?? null,
    schedule: enrichedSchedule!,
  }
})

