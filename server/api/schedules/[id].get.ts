import { and, asc, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import {
  DELETABLE_SCHEDULE_STATUSES,
  EDITABLE_SCHEDULE_STATUSES,
} from '../../../shared/utils/schedule-status.ts'
import { schedules, userSchedules, users, usersCenters } from '../../db/schema.ts'
import { requireAuth, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { enrichSchedulesForResponse } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const scheduleId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const row = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), eq(schedules.centerId, auth.centerId)),
  })

  if (!row) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  const [enriched] = await enrichSchedulesForResponse(db, [row], {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  if (!enriched || (!auth.isWorker && enriched.status === 'DRAFT')) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  if (!auth.isWorker) {
    return {
      schedule: enriched,
    }
  }

  // Workers (manager, assistant manager, instructor) also see enrolled and queued user lists with contact details (SPECIFICATION.md line 467)
  const participantRows = await db
    .select({
      userScheduleId: userSchedules.id,
      userId: users.id,
      userSubscriptionId: userSchedules.userSubscriptionId,
      isQueued: userSchedules.isQueued,
      createdAt: userSchedules.createdAt,
      name: usersCenters.name,
      surname: usersCenters.surname,
      email: users.email,
      phoneNumber: usersCenters.phoneNumber,
    })
    .from(userSchedules)
    .innerJoin(users, eq(userSchedules.userId, users.id))
    .innerJoin(
      usersCenters,
      and(
        eq(usersCenters.userId, users.id),
        eq(usersCenters.centerId, userSchedules.centerId),
      ),
    )
    .where(
      and(
        eq(userSchedules.scheduleId, scheduleId),
        eq(userSchedules.centerId, auth.centerId),
        isNull(userSchedules.deletedAt),
        isNull(users.deletedAt),
        isNull(usersCenters.deletedAt),
      ),
    )
    .orderBy(asc(userSchedules.createdAt), asc(userSchedules.id))

  const enrolledUsers = participantRows
    .filter((p) => !p.isQueued)
    .map((p) => ({
      userScheduleId: p.userScheduleId,
      userId: p.userId,
      userSubscriptionId: p.userSubscriptionId,
      name: p.name,
      surname: p.surname,
      email: p.email,
      phoneNumber: p.phoneNumber,
      enrolledAt: p.createdAt,
    }))

  const queuedUsers = participantRows
    .filter((p) => p.isQueued)
    .map((p, idx) => ({
      userScheduleId: p.userScheduleId,
      userId: p.userId,
      userSubscriptionId: p.userSubscriptionId,
      name: p.name,
      surname: p.surname,
      email: p.email,
      phoneNumber: p.phoneNumber,
      queuedAt: p.createdAt,
      queuePosition: idx + 1,
    }))

  return {
    schedule: enriched,
    enrolledUsers,
    queuedUsers,
    meta: {
      canEdit: EDITABLE_SCHEDULE_STATUSES.includes(enriched.status),
      canDelete: DELETABLE_SCHEDULE_STATUSES.includes(enriched.status),
      shouldPromptNotifyOnDelete:
        (enriched.status === 'PUBLISHED' ||
          enriched.status === 'ENROLLING' ||
          enriched.status === 'UPCOMING') &&
        enriched.enrolledCount > 0,
    },
  }
})

