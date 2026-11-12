import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler, readBody } from 'h3'
import { deleteScheduleSchema } from '../../../shared/schemas/schedules.ts'
import { DELETABLE_SCHEDULE_STATUSES } from '../../../shared/utils/schedule-status.ts'
import { classes, schedules, users } from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import {
  attachComputedScheduleMetrics,
  enrichSchedulesForResponse,
} from '../../utils/domain-queries.ts'
import { sendScheduleCancelledEmail } from '../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const scheduleId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const rawBody = await readBody(event).catch(() => ({}))
  const parsedBody = deleteScheduleSchema.safeParse(rawBody ?? {})
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      message: parsedBody.error.issues[0]?.message ?? 'Parametri di eliminazione non validi.',
    })
  }
  const { notifyEnrolled, notificationMessage } = parsedBody.data

  const existing = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), eq(schedules.centerId, auth.centerId)),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  const [currentWithMetrics] = await attachComputedScheduleMetrics(db, [existing], now)
  if (!currentWithMetrics || !DELETABLE_SCHEDULE_STATUSES.includes(currentWithMetrics.status)) {
    throw createError({
      statusCode: 409,
      message: `Impossibile annullare la lezione: l'eliminazione è consentita solo in stato DRAFT, PUBLISHED, ENROLLING o UPCOMING (stato attuale: ${currentWithMetrics?.status ?? 'SCONOSCIUTO'}).`,
    })
  }

  const cancelledRow = {
    ...existing,
    updatedBy: auth.userId,
    updatedAt: now,
    deletedAt: now,
  }

  await db
    .update(schedules)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(eq(schedules.id, scheduleId))

  let notifiedCount = 0

  // SPECIFICATION.md lines 103-104: if in PUBLISHED, ENROLLING, or UPCOMING and has enrolled users, notify if requested
  if (
    notifyEnrolled &&
    (currentWithMetrics.status === 'PUBLISHED' ||
      currentWithMetrics.status === 'ENROLLING' ||
      currentWithMetrics.status === 'UPCOMING')
  ) {
    const enrolledUserIds = Array.from(
      new Set(
        currentWithMetrics.activeUserSchedules
          .filter((r) => !r.isQueued)
          .map((r) => r.userId),
      ),
    )

    if (enrolledUserIds.length > 0) {
      const enrolledUsers = await db
        .select({ email: users.email })
        .from(users)
        .where(and(inArray(users.id, enrolledUserIds), isNull(users.deletedAt)))

      const recipientEmails = Array.from(new Set(enrolledUsers.map((u) => u.email)))
      if (recipientEmails.length > 0) {
        const course = await db.query.classes.findFirst({
          where: eq(classes.id, existing.classId),
        })

        await sendScheduleCancelledEmail(event, {
          to: recipientEmails,
          centerName: auth.centerName,
          timezone: auth.timezone,
          className: course?.name ?? 'Corso',
          startDate: existing.startDate,
          durationMinutes: existing.durationMinutes,
          customMessage: notificationMessage ?? null,
        })
        notifiedCount = recipientEmails.length
      }
    }
  }

  const [enriched] = await enrichSchedulesForResponse(db, [cancelledRow], {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  return {
    success: true,
    schedule: enriched!,
    notifiedCount,
  }
})

