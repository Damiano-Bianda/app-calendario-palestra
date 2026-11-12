import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import {
  classes,
  schedules,
  subscriptions,
  subscriptionsClasses,
  userSchedules,
  usersSubscriptions,
} from '../../db/schema.ts'
import { requireAuth } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import {
  attachComputedUserSubscriptionMetrics,
  enrichSchedulesForResponse,
  type EnrichedScheduleResponse,
} from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = useDb(event)
  const now = new Date().toISOString()
  const nowMs = Date.parse(now)

  // 1. Fetch all active user_schedules rows for the logged-in customer in the active center
  const myEnrollments = await db
    .select()
    .from(userSchedules)
    .where(
      and(
        eq(userSchedules.userId, auth.userId),
        eq(userSchedules.centerId, auth.centerId),
        isNull(userSchedules.deletedAt),
      ),
    )

  let activeSchedules: EnrichedScheduleResponse[] = []
  let cancelledSchedules: EnrichedScheduleResponse[] = []

  if (myEnrollments.length > 0) {
    const scheduleIds = Array.from(new Set(myEnrollments.map((e) => e.scheduleId)))

    // Include soft-deleted schedules so CANCELLED_BY_PROVIDER lessons are retrieved
    const rawSchedules = await db
      .select()
      .from(schedules)
      .where(and(inArray(schedules.id, scheduleIds), eq(schedules.centerId, auth.centerId)))
      .orderBy(asc(schedules.startDate), asc(schedules.createdAt))

    const enrichedSchedules = await enrichSchedulesForResponse(db, rawSchedules, {
      centerId: auth.centerId,
      currentUserId: auth.userId,
      now,
    })

    // Active schedules: ENROLLING (enrolled or queued), UPCOMING (enrolled), ACTIVE (enrolled)
    activeSchedules = enrichedSchedules.filter((s) => {
      if (s.status === 'ENROLLING') {
        return s.userEnrollment.isEnrolled || s.userEnrollment.isQueued
      }
      if (s.status === 'UPCOMING' || s.status === 'ACTIVE') {
        return s.userEnrollment.isEnrolled
      }
      return false
    })

    // Cancelled schedules: CANCELLED_LOW_ENROLLMENT or CANCELLED_BY_PROVIDER until lesson end time (start_date + duration_minutes)
    cancelledSchedules = enrichedSchedules.filter((s) => {
      if (s.status !== 'CANCELLED_LOW_ENROLLMENT' && s.status !== 'CANCELLED_BY_PROVIDER') {
        return false
      }
      const endMs = Date.parse(s.endDate)
      return !Number.isNaN(endMs) && endMs >= nowMs
    })
  }

  // 2. Fetch customer's user_subscriptions in the active center
  const userSubJoinRows = await db
    .select({
      userSub: usersSubscriptions,
      subscription: {
        id: subscriptions.id,
        name: subscriptions.name,
        description: subscriptions.description,
        entrances: subscriptions.entrances,
        durationDays: subscriptions.durationDays,
      },
    })
    .from(usersSubscriptions)
    .innerJoin(subscriptions, eq(usersSubscriptions.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(usersSubscriptions.userId, auth.userId),
        eq(usersSubscriptions.centerId, auth.centerId),
        isNull(usersSubscriptions.deletedAt),
        isNull(subscriptions.deletedAt),
      ),
    )
    .orderBy(desc(usersSubscriptions.startDate), desc(usersSubscriptions.createdAt))

  const rawSubs = userSubJoinRows.map((r) => r.userSub)
  const computedSubs = await attachComputedUserSubscriptionMetrics(db, rawSubs, now)
  const metricsById = new Map(computedSubs.map((s) => [s.id, s]))

  // Fetch associated classes for the subscription templates
  const templateIds = Array.from(new Set(rawSubs.map((s) => s.subscriptionId)))
  const subClassRows =
    templateIds.length > 0
      ? await db
          .select({
            subscriptionId: subscriptionsClasses.subscriptionId,
            id: classes.id,
            name: classes.name,
            color: classes.color,
          })
          .from(subscriptionsClasses)
          .innerJoin(classes, eq(subscriptionsClasses.classId, classes.id))
          .where(
            and(
              inArray(subscriptionsClasses.subscriptionId, templateIds),
              isNull(subscriptionsClasses.deletedAt),
              isNull(classes.deletedAt),
            ),
          )
          .orderBy(asc(classes.name))
      : []

  const classesBySubId = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >()
  for (const row of subClassRows) {
    const item = { id: row.id, name: row.name, color: row.color }
    const existing = classesBySubId.get(row.subscriptionId)
    if (existing) {
      existing.push(item)
    } else {
      classesBySubId.set(row.subscriptionId, [item])
    }
  }

  const enrichedUserSubscriptions = userSubJoinRows.map((r) => {
    const metrics = metricsById.get(r.userSub.id)!
    return {
      ...r.userSub,
      usedEntrances: metrics.usedEntrances,
      remainingEntrances: metrics.remainingEntrances,
      isActive: metrics.isActive,
      subscription: r.subscription,
      classes: classesBySubId.get(r.userSub.subscriptionId) ?? [],
    }
  })

  const activeSubscriptions = enrichedUserSubscriptions.filter((s) => s.isActive)
  const expiredSubscriptions = enrichedUserSubscriptions.filter((s) => !s.isActive)

  return {
    activeSchedules,
    cancelledSchedules,
    activeSubscriptions,
    expiredSubscriptions,
  }
})

