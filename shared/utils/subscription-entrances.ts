import {
  calculateEnrolledCount,
  calculateScheduleStatus,
  type ScheduleStatus,
  type ScheduleStatusInput,
  type UserScheduleEnrollmentRow,
} from './schedule-status.ts'

/**
 * Domain calculation utilities for `users_subscriptions.remaining_entrances`
 * and subscription eligibility, strictly implementing SPECIFICATION.md (line 370 & line 196).
 */

export interface UserSubscriptionEntrancesInput {
  id?: string
  entrances: number | null
}

/**
 * A `user_schedules` row evaluated for entrance consumption.
 * Provide either `scheduleStatus` directly, or `schedule` (with `scheduleEnrolledCount` or `scheduleUserSchedules`)
 * so the status can be dynamically computed at `now`.
 */
export type UserScheduleForEntranceCalculation = {
  userSubscriptionId?: string
  isQueued: boolean
  deletedAt: string | null
} & (
  | {
      scheduleStatus: ScheduleStatus
      schedule?: never
    }
  | {
      scheduleStatus?: never
      schedule: ScheduleStatusInput
      scheduleEnrolledCount?: number
      scheduleUserSchedules?: ReadonlyArray<UserScheduleEnrollmentRow>
    }
)

function resolveRowScheduleStatus(
  row: UserScheduleForEntranceCalculation,
  now: string | Date,
): ScheduleStatus {
  if ('scheduleStatus' in row && row.scheduleStatus !== undefined) {
    return row.scheduleStatus
  }
  const enrolledCount =
    row.scheduleEnrolledCount ??
    (row.scheduleUserSchedules ? calculateEnrolledCount(row.scheduleUserSchedules) : 0)
  return calculateScheduleStatus(row.schedule, enrolledCount, now)
}

/**
 * Determines whether a single `user_schedules` row consumes an entrance from its `users_subscriptions` record.
 *
 * Rule from SPECIFICATION.md (line 370):
 * - Row must have `deleted_at IS NULL`
 * - Exclude lessons in status `CANCELLED_BY_PROVIDER` or `CANCELLED_LOW_ENROLLMENT`
 * - Exclude rows with `is_queued = TRUE` whose lesson is no longer in status `ENROLLING`
 */
export function doesUserScheduleConsumeEntrance(
  row: UserScheduleForEntranceCalculation,
  now: string | Date = new Date(),
): boolean {
  if (row.deletedAt !== null) {
    return false
  }

  const status = resolveRowScheduleStatus(row, now)

  if (status === 'CANCELLED_BY_PROVIDER' || status === 'CANCELLED_LOW_ENROLLMENT') {
    return false
  }

  if (row.isQueued && status !== 'ENROLLING') {
    return false
  }

  return true
}

/**
 * Counts how many entrances of a `users_subscriptions` record are currently used
 * by active, valid `user_schedules` rows.
 */
export function countUsedEntrances(
  userSchedules: ReadonlyArray<UserScheduleForEntranceCalculation>,
  options: {
    userSubscriptionId?: string
    now?: string | Date
  } = {},
): number {
  const now = options.now ?? new Date()
  let used = 0

  for (const row of userSchedules) {
    if (
      options.userSubscriptionId !== undefined &&
      row.userSubscriptionId !== undefined &&
      row.userSubscriptionId !== options.userSubscriptionId
    ) {
      continue
    }
    if (doesUserScheduleConsumeEntrance(row, now)) {
      used++
    }
  }

  return used
}

/**
 * Dynamically calculates `users_subscriptions.remaining_entrances` according to SPECIFICATION.md (line 370):
 * - Returns `null` when `userSubscription.entrances === null` (unlimited entrances).
 * - Otherwise subtracts the number of valid active `user_schedules` rows from `userSubscription.entrances`.
 */
export function calculateRemainingEntrances(
  userSubscription: UserSubscriptionEntrancesInput,
  userSchedules: ReadonlyArray<UserScheduleForEntranceCalculation>,
  now: string | Date = new Date(),
): number | null {
  if (userSubscription.entrances === null) {
    return null
  }

  const used = countUsedEntrances(userSchedules, {
    userSubscriptionId: userSubscription.id,
    now,
  })

  return userSubscription.entrances - used
}

/**
 * Determines whether a `users_subscriptions` record is currently active
 * according to SPECIFICATION.md (lines 149, 174, 487, 521):
 * - Not soft-deleted (`deleted_at IS NULL`)
 * - Not expired at `now` (`end_date IS NULL` or `Date.parse(end_date) >= nowMs`)
 * - Has available entrances (`remaining_entrances === null` or `remaining_entrances >= 1`)
 */
export function isUserSubscriptionActive(
  userSubscription: {
    endDate: string | null
    deletedAt: string | null
  },
  remainingEntrances: number | null,
  now: string | Date = new Date(),
): boolean {
  if (userSubscription.deletedAt !== null) {
    return false
  }

  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime()
  if (userSubscription.endDate !== null) {
    const endMs = Date.parse(userSubscription.endDate)
    if (Number.isNaN(endMs) || endMs < nowMs) {
      return false
    }
  }

  if (remainingEntrances !== null && remainingEntrances < 1) {
    return false
  }

  return true
}

export interface CandidateUserSubscription {
  id: string
  startDate: string
  endDate: string | null
  entrances: number | null
  remainingEntrances: number | null
  enabledClassIds: ReadonlyArray<string>
  deletedAt: string | null
  createdAt?: string
}

/**
 * Selects the best eligible `users_subscriptions` record for enrolling in a lesson
 * according to SPECIFICATION.md (line 196):
 * - Subscription must not be soft-deleted (`deleted_at IS NULL`)
 * - Subscription must be enabled for `scheduleClassId`
 * - Subscription must be valid on `scheduleStartDate` (`start_date <= scheduleStartDate` and (`end_date IS NULL` or `end_date >= scheduleStartDate`))
 * - Subscription must have at least 1 remaining entrance (`remaining_entrances === null` or `remaining_entrances >= 1`)
 * - If multiple subscriptions are eligible, selects the one that expires first (`end_date` ascending, with finite `end_date` preferred before `NULL` unlimited `end_date`).
 */
export function selectBestUserSubscriptionForSchedule<T extends CandidateUserSubscription>(
  candidates: ReadonlyArray<T>,
  scheduleClassId: string,
  scheduleStartDate: string,
): T | null {
  const lessonStartMs = Date.parse(scheduleStartDate)
  if (Number.isNaN(lessonStartMs)) {
    throw new Error(`Data inizio lezione non valida: "${scheduleStartDate}"`)
  }

  const eligible = candidates.filter((sub) => {
    if (sub.deletedAt !== null) {
      return false
    }
    if (!sub.enabledClassIds.includes(scheduleClassId)) {
      return false
    }
    const subStartMs = Date.parse(sub.startDate)
    if (Number.isNaN(subStartMs) || lessonStartMs < subStartMs) {
      return false
    }
    if (sub.endDate !== null) {
      const subEndMs = Date.parse(sub.endDate)
      if (Number.isNaN(subEndMs) || lessonStartMs > subEndMs) {
        return false
      }
    }
    if (sub.remainingEntrances !== null && sub.remainingEntrances < 1) {
      return false
    }
    return true
  })

  if (eligible.length === 0) {
    return null
  }

  eligible.sort((a, b) => {
    if (a.endDate === null && b.endDate === null) {
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    }
    if (a.endDate === null) {
      return 1
    }
    if (b.endDate === null) {
      return -1
    }
    const diff = Date.parse(a.endDate) - Date.parse(b.endDate)
    if (diff !== 0) {
      return diff
    }
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  })

  return eligible[0] ?? null
}

