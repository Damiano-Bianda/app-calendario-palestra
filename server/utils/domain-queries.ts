import { and, inArray, isNull } from 'drizzle-orm'
import {
  NON_TERMINATED_SCHEDULE_STATUSES,
  computeScheduleMetrics,
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
import { schedules, userSchedules } from '../db/schema.ts'
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

