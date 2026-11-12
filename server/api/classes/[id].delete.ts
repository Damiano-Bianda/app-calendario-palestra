import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { NON_TERMINATED_SCHEDULE_STATUSES } from '../../../shared/utils/schedule-status.ts'
import { classes, schedules } from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedScheduleMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const classId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const existing = await db.query.classes.findFirst({
    where: and(
      eq(classes.id, classId),
      eq(classes.centerId, auth.centerId),
      isNull(classes.deletedAt),
    ),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Corso non trovato.',
    })
  }

  // Guard (SPECIFICATION.md lines 88-89, 451):
  // Block deletion if there are schedules in DRAFT, PUBLISHED, ENROLLING, UPCOMING, or ACTIVE status.
  const classSchedules = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.classId, classId),
        eq(schedules.centerId, auth.centerId),
        isNull(schedules.deletedAt),
      ),
    )

  const computedSchedules = await attachComputedScheduleMetrics(db, classSchedules, now)
  const blockingSchedules = computedSchedules.filter((s) =>
    NON_TERMINATED_SCHEDULE_STATUSES.includes(s.status),
  )

  if (blockingSchedules.length > 0) {
    throw createError({
      statusCode: 409,
      message:
        'Impossibile eliminare il corso: esistono lezioni in stato bozza, pubblicata, iscrizioni aperte, in partenza o in corso. Elimina prima tali lezioni.',
    })
  }

  await db
    .update(classes)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(eq(classes.id, classId))

  return {
    success: true,
    id: classId,
  }
})

