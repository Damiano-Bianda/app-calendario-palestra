import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { NON_TERMINATED_SCHEDULE_STATUSES } from '../../../shared/utils/schedule-status.ts'
import { classes, schedules } from '../../db/schema.ts'
import { requireUuidParam, requireWorker } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedScheduleMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const classId = requireUuidParam(event, 'id')
  const db = useDb(event)

  const course = await db.query.classes.findFirst({
    where: and(
      eq(classes.id, classId),
      eq(classes.centerId, auth.centerId),
      isNull(classes.deletedAt),
    ),
  })

  if (!course) {
    throw createError({
      statusCode: 404,
      message: 'Corso non trovato.',
    })
  }

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

  const computedSchedules = await attachComputedScheduleMetrics(db, classSchedules)

  const hasEnrolledInEnrollingOrUpcoming = computedSchedules.some(
    (s) => (s.status === 'ENROLLING' || s.status === 'UPCOMING') && s.enrolledCount > 0,
  )

  const nonTerminatedSchedulesCount = computedSchedules.filter((s) =>
    NON_TERMINATED_SCHEDULE_STATUSES.includes(s.status),
  ).length

  return {
    class: course,
    meta: {
      hasEnrolledInEnrollingOrUpcoming,
      nonTerminatedSchedulesCount,
    },
  }
})

