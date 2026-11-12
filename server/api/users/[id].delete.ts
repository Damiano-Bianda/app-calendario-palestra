import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import {
  ACTIVE_CUSTOMER_SCHEDULE_STATUSES,
  NON_TERMINATED_SCHEDULE_STATUSES,
} from '../../../shared/utils/schedule-status.ts'
import {
  schedules,
  userSchedules,
  users,
  usersCenters,
  usersSubscriptions,
} from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import {
  attachComputedScheduleMetrics,
  attachComputedUserSubscriptionMetrics,
} from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const targetUserId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const rows = await db
    .select({
      membership: usersCenters,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.userId, targetUserId),
        eq(usersCenters.centerId, auth.centerId),
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const found = rows[0]
  if (!found) {
    throw createError({
      statusCode: 404,
      message: 'Utente non trovato nella sede attiva.',
    })
  }

  // Guard 1 (SPECIFICATION.md lines 27, 521):
  // The center Manager cannot be deleted.
  if (found.membership.isManager) {
    throw createError({
      statusCode: 409,
      message: 'Impossibile eliminare il gerente della sede.',
    })
  }

  // Guard 2 (SPECIFICATION.md lines 149-150, 521):
  // Block if the user is enrolled in active lessons (`ENROLLING`, `UPCOMING`, `ACTIVE`).
  const customerEnrollments = await db
    .select()
    .from(userSchedules)
    .where(
      and(
        eq(userSchedules.userId, targetUserId),
        eq(userSchedules.centerId, auth.centerId),
        isNull(userSchedules.deletedAt),
      ),
    )

  if (customerEnrollments.length > 0) {
    const enrolledScheduleIds = Array.from(new Set(customerEnrollments.map((e) => e.scheduleId)))
    const enrolledSchedules = await db
      .select()
      .from(schedules)
      .where(and(inArray(schedules.id, enrolledScheduleIds), isNull(schedules.deletedAt)))

    const computedEnrolledSchedules = await attachComputedScheduleMetrics(
      db,
      enrolledSchedules,
      now,
    )
    const scheduleById = new Map(computedEnrolledSchedules.map((s) => [s.id, s]))

    const hasActiveCustomerLesson = customerEnrollments.some((enrollment) => {
      const sched = scheduleById.get(enrollment.scheduleId)
      if (!sched) {
        return false
      }
      if (enrollment.isQueued) {
        return sched.status === 'ENROLLING'
      }
      return ACTIVE_CUSTOMER_SCHEDULE_STATUSES.includes(sched.status)
    })

    if (hasActiveCustomerLesson) {
      throw createError({
        statusCode: 409,
        message: "Impossibile eliminare l'utente: risulta iscritto a lezioni attive.",
      })
    }
  }

  // Guard 3 (SPECIFICATION.md lines 149-150, 521):
  // Block if the user has active user subscriptions (not expired and with available entrances).
  const userSubs = await db
    .select()
    .from(usersSubscriptions)
    .where(
      and(
        eq(usersSubscriptions.userId, targetUserId),
        eq(usersSubscriptions.centerId, auth.centerId),
        isNull(usersSubscriptions.deletedAt),
      ),
    )

  if (userSubs.length > 0) {
    const computedSubs = await attachComputedUserSubscriptionMetrics(db, userSubs, now)
    if (computedSubs.some((s) => s.isActive)) {
      throw createError({
        statusCode: 409,
        message:
          "Impossibile eliminare l'utente: possiede sottoscrizioni d'abbonamento ancora attive.",
      })
    }
  }

  // Guard 4 (SPECIFICATION.md lines 151-152, 521):
  // Block if the user is an instructor and has assigned lessons in DRAFT, PUBLISHED, ENROLLING, UPCOMING, or ACTIVE status.
  const instructorSchedules = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.instructorId, targetUserId),
        eq(schedules.centerId, auth.centerId),
        isNull(schedules.deletedAt),
      ),
    )

  if (instructorSchedules.length > 0) {
    const computedInstructorSchedules = await attachComputedScheduleMetrics(
      db,
      instructorSchedules,
      now,
    )
    const hasNonTerminatedInstructorSchedules = computedInstructorSchedules.some((s) =>
      NON_TERMINATED_SCHEDULE_STATUSES.includes(s.status),
    )

    if (hasNonTerminatedInstructorSchedules) {
      throw createError({
        statusCode: 409,
        message:
          "Impossibile eliminare l'utente: ha lezioni assegnate come istruttore non ancora terminate.",
      })
    }
  }

  // Soft delete membership in `users_centers` (SPECIFICATION.md line 521)
  await db
    .update(usersCenters)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(eq(usersCenters.id, found.membership.id))

  return {
    success: true,
    id: targetUserId,
  }
})

