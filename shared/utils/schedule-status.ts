/**
 * Domain calculation utilities for `schedules` (`status`, `enrolled_count`, `remaining_spots`)
 * and schedule timeline invariants, strictly implementing SPECIFICATION.md.
 */

export const SCHEDULE_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ENROLLING',
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED_LOW_ENROLLMENT',
  'CANCELLED_BY_PROVIDER',
] as const

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number]

/**
 * Statuses considered non-terminated for class/instructor deletion guards
 * (SPECIFICATION.md: `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`, `ACTIVE`).
 */
export const NON_TERMINATED_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'ENROLLING',
  'UPCOMING',
  'ACTIVE',
] as const

/**
 * Statuses considered active for customer enrollment/summary
 * (SPECIFICATION.md: `ENROLLING`, `UPCOMING`, `ACTIVE`).
 */
export const ACTIVE_CUSTOMER_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'ENROLLING',
  'UPCOMING',
  'ACTIVE',
] as const

/**
 * Statuses in which a manager/assistant manager is allowed to soft-delete a schedule
 * (SPECIFICATION.md: `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`).
 */
export const DELETABLE_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'ENROLLING',
  'UPCOMING',
] as const

/**
 * Statuses in which a manager/assistant manager is allowed to edit a schedule
 * (SPECIFICATION.md: `DRAFT`, `PUBLISHED`).
 */
export const EDITABLE_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'DRAFT',
  'PUBLISHED',
] as const

export interface ScheduleStatusInput {
  startDate: string
  durationMinutes: number
  availableSpots: number | null
  minimumSpots: number
  publicationMinutesBefore: number | null
  registrationOpenMinutesBefore: number | null
  registrationCloseMinutesBefore: number | null
  createdAt: string
  deletedAt: string | null
}

export interface UserScheduleEnrollmentRow {
  isQueued: boolean
  deletedAt: string | null
}

export interface ComputedScheduleMetrics {
  status: ScheduleStatus
  enrolledCount: number
  remainingSpots: number | null
}

function toTimestampMs(dateOrIso: string | Date): number {
  const ms = typeof dateOrIso === 'string' ? Date.parse(dateOrIso) : dateOrIso.getTime()
  if (Number.isNaN(ms)) {
    throw new Error(`Timestamp non valido: "${String(dateOrIso)}"`)
  }
  return ms
}

/**
 * Calculates `enrolled_count` by counting rows in `user_schedules` where
 * `deleted_at IS NULL` and `is_queued = FALSE` (SPECIFICATION.md line 317).
 */
export function calculateEnrolledCount(
  userSchedules: ReadonlyArray<UserScheduleEnrollmentRow>,
): number {
  let count = 0
  for (const row of userSchedules) {
    if (row.deletedAt === null && row.isQueued === false) {
      count++
    }
  }
  return count
}

/**
 * Calculates `remaining_spots` as `available_spots - enrolled_count`,
 * or `null` when `available_spots` is `null` (unlimited spots) (SPECIFICATION.md line 317).
 */
export function calculateRemainingSpots(
  availableSpots: number | null,
  enrolledCount: number,
): number | null {
  if (availableSpots === null) {
    return null
  }
  return availableSpots - enrolledCount
}

/**
 * Computes the milestone timestamps (in milliseconds since Unix epoch) for a schedule
 * according to SPECIFICATION.md line 319:
 * - When `publication_minutes_before` is `NULL`, `publicationAt` equals `created_at`.
 * - When `registration_open_minutes_before` is `NULL`, `registrationOpenAt` equals `created_at`.
 * - When `registration_close_minutes_before` is `NULL`, `registrationCloseAt` equals `start_date` (0 minutes before).
 */
export function getScheduleTimelineMilestonesMs(
  schedule: Pick<
    ScheduleStatusInput,
    | 'startDate'
    | 'durationMinutes'
    | 'publicationMinutesBefore'
    | 'registrationOpenMinutesBefore'
    | 'registrationCloseMinutesBefore'
    | 'createdAt'
  >,
): {
  createdAtMs: number
  publicationAtMs: number
  registrationOpenAtMs: number
  registrationCloseAtMs: number
  startDateMs: number
  endDateMs: number
} {
  const createdAtMs = toTimestampMs(schedule.createdAt)
  const startDateMs = toTimestampMs(schedule.startDate)
  const endDateMs = startDateMs + schedule.durationMinutes * 60_000

  const publicationAtMs =
    schedule.publicationMinutesBefore === null
      ? createdAtMs
      : startDateMs - schedule.publicationMinutesBefore * 60_000

  const registrationOpenAtMs =
    schedule.registrationOpenMinutesBefore === null
      ? createdAtMs
      : startDateMs - schedule.registrationOpenMinutesBefore * 60_000

  const registrationCloseAtMs =
    schedule.registrationCloseMinutesBefore === null
      ? startDateMs
      : startDateMs - schedule.registrationCloseMinutesBefore * 60_000

  return {
    createdAtMs,
    publicationAtMs,
    registrationOpenAtMs,
    registrationCloseAtMs,
    startDateMs,
    endDateMs,
  }
}

/**
 * Dynamically calculates `schedules.status` according to the exact table in SPECIFICATION.md (lines 319-330):
 * - `CANCELLED_BY_PROVIDER`: `schedules.deleted_at IS NOT NULL`
 * - `DRAFT`: `created_at <= now < start_date - date(publication_minutes_before)`
 * - `PUBLISHED`: `start_date - date(publication_minutes_before) <= now < start_date - date(registration_open_minutes_before)`
 * - `ENROLLING`: `start_date - date(registration_open_minutes_before) <= now < start_date - date(registration_close_minutes_before)`
 * - `UPCOMING`: `start_date - date(registration_close_minutes_before) <= now < start_date && (enrolled_count >= minimum_spots)`
 * - `ACTIVE`: `start_date <= now < start_date + date(duration_minutes) && (enrolled_count >= minimum_spots)`
 * - `COMPLETED`: `(now >= start_date + date(duration_minutes)) && (enrolled_count >= minimum_spots)`
 * - `CANCELLED_LOW_ENROLLMENT`: `(start_date - date(registration_close_minutes_before)) <= now && (enrolled_count < minimum_spots)`
 */
export function calculateScheduleStatus(
  schedule: ScheduleStatusInput,
  enrolledCount: number,
  now: string | Date = new Date(),
): ScheduleStatus {
  if (schedule.deletedAt !== null && schedule.deletedAt !== undefined) {
    return 'CANCELLED_BY_PROVIDER'
  }

  const nowMs = toTimestampMs(now)
  const {
    publicationAtMs,
    registrationOpenAtMs,
    registrationCloseAtMs,
    startDateMs,
    endDateMs,
  } = getScheduleTimelineMilestonesMs(schedule)

  if (nowMs < publicationAtMs) {
    return 'DRAFT'
  }

  if (nowMs < registrationOpenAtMs) {
    return 'PUBLISHED'
  }

  if (nowMs < registrationCloseAtMs) {
    return 'ENROLLING'
  }

  // Once registration closes (`now >= start_date - registration_close_minutes_before`),
  // if enrolled_count < minimum_spots, the lesson is CANCELLED_LOW_ENROLLMENT.
  if (enrolledCount < schedule.minimumSpots) {
    return 'CANCELLED_LOW_ENROLLMENT'
  }

  if (nowMs < startDateMs) {
    return 'UPCOMING'
  }

  if (nowMs < endDateMs) {
    return 'ACTIVE'
  }

  return 'COMPLETED'
}

/**
 * Computes `status`, `enrolledCount`, and `remainingSpots` together for a schedule.
 */
export function computeScheduleMetrics(
  schedule: ScheduleStatusInput,
  userSchedules: ReadonlyArray<UserScheduleEnrollmentRow>,
  now: string | Date = new Date(),
): ComputedScheduleMetrics {
  const enrolledCount = calculateEnrolledCount(userSchedules)
  const remainingSpots = calculateRemainingSpots(schedule.availableSpots, enrolledCount)
  const status = calculateScheduleStatus(schedule, enrolledCount, now)

  return {
    status,
    enrolledCount,
    remainingSpots,
  }
}

/**
 * Validates the creation margin rule from SPECIFICATION.md (lines 97 & 333):
 * `start_date - (registration_close_minutes_before ?? 0) > now() + 5 minutes`
 */
export function isScheduleCreationMarginValid(
  startDate: string,
  registrationCloseMinutesBefore: number | null,
  now: string | Date = new Date(),
): boolean {
  const startDateMs = toTimestampMs(startDate)
  const nowMs = toTimestampMs(now)
  const closeOffsetMs = (registrationCloseMinutesBefore ?? 0) * 60_000
  const registrationCloseAtMs = startDateMs - closeOffsetMs
  return registrationCloseAtMs > nowMs + 5 * 60_000
}

/**
 * Validates the timeline ordering constraint from SPECIFICATION.md (line 334):
 * `start_date + duration > start_date >= close_at >= open_at >= publication_at >= created_at`
 */
export function isScheduleTimelineOrderValid(
  schedule: Pick<
    ScheduleStatusInput,
    | 'startDate'
    | 'durationMinutes'
    | 'publicationMinutesBefore'
    | 'registrationOpenMinutesBefore'
    | 'registrationCloseMinutesBefore'
    | 'createdAt'
  >,
): boolean {
  const {
    createdAtMs,
    publicationAtMs,
    registrationOpenAtMs,
    registrationCloseAtMs,
    startDateMs,
    endDateMs,
  } = getScheduleTimelineMilestonesMs(schedule)

  return (
    endDateMs > startDateMs &&
    startDateMs >= registrationCloseAtMs &&
    registrationCloseAtMs >= registrationOpenAtMs &&
    registrationOpenAtMs >= publicationAtMs &&
    publicationAtMs >= createdAtMs
  )
}

