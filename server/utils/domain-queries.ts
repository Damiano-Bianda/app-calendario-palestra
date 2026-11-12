import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  NON_TERMINATED_SCHEDULE_STATUSES,
  computeScheduleMetrics,
  getCustomerScheduleStatusLabel,
  type ComputedScheduleMetrics,
  type ScheduleStatus,
} from '../../shared/utils/schedule-status.ts'
import {
  calculateRemainingEntrances,
  countUsedEntrances,
  doesUserScheduleConsumeEntrance,
  isUserSubscriptionActive,
  type UserScheduleForEntranceCalculation,
} from '../../shared/utils/subscription-entrances.ts'
import {
  classes,
  schedules,
  subscriptions,
  subscriptionsClasses,
  userSchedules,
  users,
  usersCenters,
  type ClassColor,
} from '../db/schema.ts'
import type { AppDatabase } from './db.ts'

export type ScheduleRow = typeof schedules.$inferSelect
export type UserScheduleRow = typeof userSchedules.$inferSelect

export interface ScheduleWithComputedMetrics extends ScheduleRow, ComputedScheduleMetrics {
  queuedCount: number
  activeUserSchedules: UserScheduleRow[]
}

/**
 * Fetches active `user_schedules` (`deleted_at IS NULL`) for a list of `schedules` rows
 * and computes `status`, `enrolledCount`, `remainingSpots`, and `queuedCount` for each schedule.
 */
export async function attachComputedScheduleMetrics(
  db: AppDatabase,
  scheduleRows: ReadonlyArray<ScheduleRow>,
  now: string | Date = new Date(),
): Promise<ScheduleWithComputedMetrics[]> {
  if (scheduleRows.length === 0) {
    return []
  }

  const scheduleIds = scheduleRows.map((s) => s.id)
  const enrollmentRows = await db
    .select()
    .from(userSchedules)
    .where(and(inArray(userSchedules.scheduleId, scheduleIds), isNull(userSchedules.deletedAt)))

  const byScheduleId = new Map<string, UserScheduleRow[]>()
  for (const row of enrollmentRows) {
    const list = byScheduleId.get(row.scheduleId)
    if (list) {
      list.push(row)
    } else {
      byScheduleId.set(row.scheduleId, [row])
    }
  }

  return scheduleRows.map((schedule) => {
    const activeRows = byScheduleId.get(schedule.id) ?? []
    const metrics = computeScheduleMetrics(schedule, activeRows, now)
    const queuedCount = activeRows.filter((r) => r.isQueued).length

    return {
      ...schedule,
      ...metrics,
      queuedCount,
      activeUserSchedules: activeRows,
    }
  })
}

export interface ScheduleClassSummary {
  id: string
  name: string
  description: string | null
  color: ClassColor
}

export interface ScheduleInstructorSummary {
  id: string
  name: string
  surname: string
  email: string
  phoneNumber: string
}

export interface ScheduleRequiredSubscriptionSummary {
  id: string
  name: string
  description: string | null
  entrances: number | null
  durationDays: number | null
}

export interface ScheduleUserEnrollmentState {
  isEnrolled: boolean
  isQueued: boolean
  queuePosition: number | null
  userScheduleId: string | null
  userSubscriptionId: string | null
}

export interface EnrichedScheduleResponse extends ScheduleRow, ComputedScheduleMetrics {
  endDate: string
  queuedCount: number
  class: ScheduleClassSummary | null
  instructor: ScheduleInstructorSummary | null
  requiredSubscriptions: ScheduleRequiredSubscriptionSummary[]
  userEnrollment: ScheduleUserEnrollmentState
  customerStatusLabel: string
}

/**
 * Enriches a list of `schedules` rows with computed metrics (`status`, `enrolledCount`, `remainingSpots`, `queuedCount`, `endDate`),
 * course metadata (`class`), instructor details (`instructor`), required subscriptions (`requiredSubscriptions`),
 * and the requesting user's enrollment/queue state (`userEnrollment`, `customerStatusLabel`).
 */
export async function enrichSchedulesForResponse(
  db: AppDatabase,
  scheduleRows: ReadonlyArray<ScheduleRow>,
  options: {
    centerId: string
    currentUserId?: string
    now?: string | Date
  },
): Promise<EnrichedScheduleResponse[]> {
  if (scheduleRows.length === 0) {
    return []
  }

  const now = options.now ?? new Date()
  const withMetrics = await attachComputedScheduleMetrics(db, scheduleRows, now)

  const classIds = Array.from(new Set(scheduleRows.map((s) => s.classId)))
  const instructorIds = Array.from(
    new Set(scheduleRows.map((s) => s.instructorId).filter((id): id is string => Boolean(id))),
  )

  // 1. Fetch classes (include even if soft-deleted later so historical/cancelled schedules retain class metadata)
  const classRows =
    classIds.length > 0
      ? await db
          .select({
            id: classes.id,
            name: classes.name,
            description: classes.description,
            color: classes.color,
          })
          .from(classes)
          .where(and(inArray(classes.id, classIds), eq(classes.centerId, options.centerId)))
      : []

  const classById = new Map<string, ScheduleClassSummary>()
  for (const c of classRows) {
    classById.set(c.id, c)
  }

  // 2. Fetch instructors in the center
  const instructorRows =
    instructorIds.length > 0
      ? await db
          .select({
            id: users.id,
            name: usersCenters.name,
            surname: usersCenters.surname,
            email: users.email,
            phoneNumber: usersCenters.phoneNumber,
          })
          .from(usersCenters)
          .innerJoin(users, eq(usersCenters.userId, users.id))
          .where(
            and(
              eq(usersCenters.centerId, options.centerId),
              inArray(usersCenters.userId, instructorIds),
              isNull(usersCenters.deletedAt),
              isNull(users.deletedAt),
            ),
          )
      : []

  const instructorById = new Map<string, ScheduleInstructorSummary>()
  for (const instr of instructorRows) {
    instructorById.set(instr.id, instr)
  }

  // 3. Fetch active required subscriptions for each classId
  const reqSubRows =
    classIds.length > 0
      ? await db
          .select({
            classId: subscriptionsClasses.classId,
            id: subscriptions.id,
            name: subscriptions.name,
            description: subscriptions.description,
            entrances: subscriptions.entrances,
            durationDays: subscriptions.durationDays,
          })
          .from(subscriptionsClasses)
          .innerJoin(subscriptions, eq(subscriptionsClasses.subscriptionId, subscriptions.id))
          .where(
            and(
              inArray(subscriptionsClasses.classId, classIds),
              eq(subscriptions.centerId, options.centerId),
              isNull(subscriptionsClasses.deletedAt),
              isNull(subscriptions.deletedAt),
            ),
          )
          .orderBy(asc(subscriptions.name))
      : []

  const requiredSubsByClassId = new Map<string, ScheduleRequiredSubscriptionSummary[]>()
  for (const row of reqSubRows) {
    const summary: ScheduleRequiredSubscriptionSummary = {
      id: row.id,
      name: row.name,
      description: row.description,
      entrances: row.entrances,
      durationDays: row.durationDays,
    }
    const existing = requiredSubsByClassId.get(row.classId)
    if (existing) {
      if (!existing.some((s) => s.id === summary.id)) {
        existing.push(summary)
      }
    } else {
      requiredSubsByClassId.set(row.classId, [summary])
    }
  }

  return withMetrics.map((sched) => {
    const { activeUserSchedules, ...scheduleBase } = sched

    const sortedQueue = activeUserSchedules
      .filter((r) => r.isQueued)
      .sort((a, b) => {
        const cmp = a.createdAt.localeCompare(b.createdAt)
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
      })

    const myEnrollmentRow = options.currentUserId
      ? activeUserSchedules.find((r) => r.userId === options.currentUserId)
      : undefined

    const isEnrolled = Boolean(myEnrollmentRow && !myEnrollmentRow.isQueued)
    const isQueued = Boolean(myEnrollmentRow && myEnrollmentRow.isQueued)
    const queuePosition =
      isQueued && myEnrollmentRow
        ? sortedQueue.findIndex((r) => r.id === myEnrollmentRow.id) + 1
        : null

    const userEnrollment: ScheduleUserEnrollmentState = {
      isEnrolled,
      isQueued,
      queuePosition,
      userScheduleId: myEnrollmentRow?.id ?? null,
      userSubscriptionId: myEnrollmentRow?.userSubscriptionId ?? null,
    }

    const endDate = new Date(
      Date.parse(sched.startDate) + sched.durationMinutes * 60_000,
    ).toISOString()

    return {
      ...scheduleBase,
      endDate,
      class: classById.get(sched.classId) ?? null,
      instructor: sched.instructorId ? (instructorById.get(sched.instructorId) ?? null) : null,
      requiredSubscriptions: requiredSubsByClassId.get(sched.classId) ?? [],
      userEnrollment,
      customerStatusLabel: getCustomerScheduleStatusLabel(sched.status, userEnrollment),
    }
  })
}


export interface UserSubscriptionMinimalRow {
  id: string
  subscriptionId: string
  centerId: string
  userId: string
  startDate: string
  endDate: string | null
  entrances: number | null
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ComputedUserSubscriptionMetrics {
  usedEntrances: number
  remainingEntrances: number | null
  isActive: boolean
  bookedScheduleStartDates: string[]
  hasActiveOrQueuedFutureSchedules: boolean
}

export type UserSubscriptionWithMetrics<T extends UserSubscriptionMinimalRow> = T &
  ComputedUserSubscriptionMetrics

function isScheduleActiveOrQueuedForSubscriptionDeletion(
  isQueued: boolean,
  status: ScheduleStatus,
): boolean {
  if (isQueued) {
    return status === 'ENROLLING'
  }
  return NON_TERMINATED_SCHEDULE_STATUSES.includes(status)
}

/**
 * Fetches active `user_schedules` (`deleted_at IS NULL`) and their associated `schedules`
 * (including soft-deleted `CANCELLED_BY_PROVIDER` schedules) for a list of `users_subscriptions` rows,
 * dynamically computing `usedEntrances`, `remainingEntrances`, `isActive`, `bookedScheduleStartDates`,
 * and `hasActiveOrQueuedFutureSchedules`.
 */
export async function attachComputedUserSubscriptionMetrics<T extends UserSubscriptionMinimalRow>(
  db: AppDatabase,
  userSubscriptionRows: ReadonlyArray<T>,
  now: string | Date = new Date(),
): Promise<Array<UserSubscriptionWithMetrics<T>>> {
  if (userSubscriptionRows.length === 0) {
    return []
  }

  const userSubIds = userSubscriptionRows.map((s) => s.id)

  // 1. Fetch all active user_schedules rows linked to these user subscriptions
  const subEnrollmentRows = await db
    .select()
    .from(userSchedules)
    .where(
      and(
        inArray(userSchedules.userSubscriptionId, userSubIds),
        isNull(userSchedules.deletedAt),
      ),
    )

  if (subEnrollmentRows.length === 0) {
    return userSubscriptionRows.map((sub) => {
      const remainingEntrances = sub.entrances
      const isActive = isUserSubscriptionActive(sub, remainingEntrances, now)
      return {
        ...sub,
        usedEntrances: 0,
        remainingEntrances,
        isActive,
        bookedScheduleStartDates: [],
        hasActiveOrQueuedFutureSchedules: false,
      }
    })
  }

  // 2. Fetch the referenced schedules (including soft-deleted ones so CANCELLED_BY_PROVIDER is detected)
  const scheduleIds = Array.from(new Set(subEnrollmentRows.map((r) => r.scheduleId)))
  const rawSchedules = await db
    .select()
    .from(schedules)
    .where(inArray(schedules.id, scheduleIds))

  // 3. Compute dynamic status for each referenced schedule (requires all active enrollments of that schedule)
  const schedulesWithMetrics = await attachComputedScheduleMetrics(db, rawSchedules, now)
  const scheduleById = new Map<string, ScheduleWithComputedMetrics>()
  for (const s of schedulesWithMetrics) {
    scheduleById.set(s.id, s)
  }

  // 4. Group user_schedules by userSubscriptionId and compute entrance metrics
  const enrollmentsBySubId = new Map<
    string,
    Array<{
      enrollment: UserScheduleRow
      schedule: ScheduleWithComputedMetrics
    }>
  >()

  for (const enrollment of subEnrollmentRows) {
    const schedule = scheduleById.get(enrollment.scheduleId)
    if (!schedule) {
      continue
    }
    const list = enrollmentsBySubId.get(enrollment.userSubscriptionId)
    if (list) {
      list.push({ enrollment, schedule })
    } else {
      enrollmentsBySubId.set(enrollment.userSubscriptionId, [{ enrollment, schedule }])
    }
  }

  return userSubscriptionRows.map((sub) => {
    const items = enrollmentsBySubId.get(sub.id) ?? []

    const entranceRows: UserScheduleForEntranceCalculation[] = items.map(
      ({ enrollment, schedule }) => ({
        userSubscriptionId: sub.id,
        isQueued: enrollment.isQueued,
        deletedAt: enrollment.deletedAt,
        scheduleStatus: schedule.status,
      }),
    )

    const usedEntrances = countUsedEntrances(entranceRows, {
      userSubscriptionId: sub.id,
      now,
    })

    const remainingEntrances = calculateRemainingEntrances(sub, entranceRows, now)
    const isActive = isUserSubscriptionActive(sub, remainingEntrances, now)

    const bookedScheduleStartDates: string[] = []
    let hasActiveOrQueuedFutureSchedules = false

    for (const { enrollment, schedule } of items) {
      const rowForCalc: UserScheduleForEntranceCalculation = {
        userSubscriptionId: sub.id,
        isQueued: enrollment.isQueued,
        deletedAt: enrollment.deletedAt,
        scheduleStatus: schedule.status,
      }

      if (doesUserScheduleConsumeEntrance(rowForCalc, now)) {
        bookedScheduleStartDates.push(schedule.startDate)
      }

      if (isScheduleActiveOrQueuedForSubscriptionDeletion(enrollment.isQueued, schedule.status)) {
        hasActiveOrQueuedFutureSchedules = true
      }
    }

    return {
      ...sub,
      usedEntrances,
      remainingEntrances,
      isActive,
      bookedScheduleStartDates,
      hasActiveOrQueuedFutureSchedules,
    }
  })
}

