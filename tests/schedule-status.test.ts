import { describe, expect, it } from 'vitest'
import {
  calculateEnrolledCount,
  calculateRemainingSpots,
  calculateScheduleStatus,
  computeScheduleMetrics,
  isScheduleCreationMarginValid,
  isScheduleTimelineOrderValid,
  type ScheduleStatusInput,
} from '../shared/utils/schedule-status'

describe('Schedule Status, Enrolled Count & Remaining Spots (shared/utils/schedule-status.ts)', () => {
  const baseSchedule: ScheduleStatusInput = {
    createdAt: '2026-11-10T10:00:00.000Z',
    // Lesson starts 2026-11-12 at 18:00Z, duration 60m (ends at 19:00Z)
    startDate: '2026-11-12T18:00:00.000Z',
    durationMinutes: 60,
    availableSpots: 10,
    minimumSpots: 3,
    // Published 24h before (2026-11-11T18:00:00.000Z)
    publicationMinutesBefore: 1440,
    // Registration opens 12h before (2026-11-12T06:00:00.000Z)
    registrationOpenMinutesBefore: 720,
    // Registration closes 1h before (2026-11-12T17:00:00.000Z)
    registrationCloseMinutesBefore: 60,
    deletedAt: null,
  }

  it('calculates enrolled_count (active non-queued rows only) and remaining_spots (finite vs NULL unlimited)', () => {
    const userSchedules = [
      { isQueued: false, deletedAt: null }, // Enrolled #1
      { isQueued: false, deletedAt: null }, // Enrolled #2
      { isQueued: true, deletedAt: null }, // Waitlisted -> excluded from enrolled_count
      { isQueued: false, deletedAt: '2026-11-11T12:00:00.000Z' }, // Soft-deleted -> excluded
    ]

    const enrolledCount = calculateEnrolledCount(userSchedules)
    expect(enrolledCount).toBe(2)

    expect(calculateRemainingSpots(10, enrolledCount)).toBe(8)
    expect(calculateRemainingSpots(null, enrolledCount)).toBeNull()
  })

  it('transitions accurately through all 8 statuses across timeline boundaries', () => {
    // 1. DRAFT: created_at <= now < start_date - publication_minutes_before (2026-11-11T18:00:00.000Z)
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-10T10:00:00.000Z')).toBe('DRAFT')
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-11T17:59:59.999Z')).toBe('DRAFT')

    // 2. PUBLISHED: publication <= now < registration_open (2026-11-12T06:00:00.000Z)
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-11T18:00:00.000Z')).toBe('PUBLISHED')
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-12T05:59:59.999Z')).toBe('PUBLISHED')

    // 3. ENROLLING: registration_open <= now < registration_close (2026-11-12T17:00:00.000Z)
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-12T06:00:00.000Z')).toBe('ENROLLING')
    expect(calculateScheduleStatus(baseSchedule, 2, '2026-11-12T16:59:59.999Z')).toBe('ENROLLING')

    // 4. UPCOMING: registration_close <= now < start_date AND enrolled_count >= minimum_spots (3)
    expect(calculateScheduleStatus(baseSchedule, 3, '2026-11-12T17:00:00.000Z')).toBe('UPCOMING')
    expect(calculateScheduleStatus(baseSchedule, 5, '2026-11-12T17:59:59.999Z')).toBe('UPCOMING')

    // 5. ACTIVE: start_date <= now < start_date + duration AND enrolled_count >= minimum_spots
    expect(calculateScheduleStatus(baseSchedule, 3, '2026-11-12T18:00:00.000Z')).toBe('ACTIVE')
    expect(calculateScheduleStatus(baseSchedule, 3, '2026-11-12T18:59:59.999Z')).toBe('ACTIVE')

    // 6. COMPLETED: now >= start_date + duration AND enrolled_count >= minimum_spots
    expect(calculateScheduleStatus(baseSchedule, 3, '2026-11-12T19:00:00.000Z')).toBe('COMPLETED')
    expect(calculateScheduleStatus(baseSchedule, 10, '2026-11-13T00:00:00.000Z')).toBe('COMPLETED')

    // 7. CANCELLED_LOW_ENROLLMENT: now >= registration_close AND enrolled_count < minimum_spots
    expect(calculateScheduleStatus(baseSchedule, 2, '2026-11-12T17:00:00.000Z')).toBe(
      'CANCELLED_LOW_ENROLLMENT',
    )
    expect(calculateScheduleStatus(baseSchedule, 2, '2026-11-12T18:30:00.000Z')).toBe(
      'CANCELLED_LOW_ENROLLMENT',
    )
    expect(calculateScheduleStatus(baseSchedule, 0, '2026-11-12T20:00:00.000Z')).toBe(
      'CANCELLED_LOW_ENROLLMENT',
    )

    // 8. CANCELLED_BY_PROVIDER: deleted_at IS NOT NULL (regardless of time or enrolled_count)
    const deletedSchedule: ScheduleStatusInput = {
      ...baseSchedule,
      deletedAt: '2026-11-11T12:00:00.000Z',
    }
    expect(calculateScheduleStatus(deletedSchedule, 5, '2026-11-11T15:00:00.000Z')).toBe(
      'CANCELLED_BY_PROVIDER',
    )
    expect(calculateScheduleStatus(deletedSchedule, 5, '2026-11-12T18:30:00.000Z')).toBe(
      'CANCELLED_BY_PROVIDER',
    )
  })

  it('handles NULL minute offsets according to SPECIFICATION.md (created_at for publication/open, 0 for close)', () => {
    const immediateSchedule: ScheduleStatusInput = {
      ...baseSchedule,
      publicationMinutesBefore: null, // Immediately visible at created_at
      registrationOpenMinutesBefore: null, // Immediately open at created_at
      registrationCloseMinutesBefore: null, // Open until start_date (0 minutes before)
    }

    // At created_at, skips DRAFT and PUBLISHED and is immediately ENROLLING
    expect(calculateScheduleStatus(immediateSchedule, 0, '2026-11-10T10:00:00.000Z')).toBe(
      'ENROLLING',
    )
    // 1 ms before start_date is still ENROLLING
    expect(calculateScheduleStatus(immediateSchedule, 1, '2026-11-12T17:59:59.999Z')).toBe(
      'ENROLLING',
    )
    // At exact start_date, transitions directly to ACTIVE (if minimum_spots met) or CANCELLED_LOW_ENROLLMENT
    expect(calculateScheduleStatus(immediateSchedule, 3, '2026-11-12T18:00:00.000Z')).toBe('ACTIVE')
    expect(calculateScheduleStatus(immediateSchedule, 2, '2026-11-12T18:00:00.000Z')).toBe(
      'CANCELLED_LOW_ENROLLMENT',
    )
  })

  it('computes combined metrics and validates creation margin and timeline ordering', () => {
    const metrics = computeScheduleMetrics(
      baseSchedule,
      [
        { isQueued: false, deletedAt: null },
        { isQueued: false, deletedAt: null },
        { isQueued: false, deletedAt: null },
      ],
      '2026-11-12T12:00:00.000Z',
    )
    expect(metrics).toEqual({
      status: 'ENROLLING',
      enrolledCount: 3,
      remainingSpots: 7,
    })

    // Creation margin: registration_close is 2026-11-12T17:00:00.000Z.
    // Must be > now + 5 minutes -> valid at 16:54:59Z, invalid at 16:55:00Z.
    expect(isScheduleCreationMarginValid(baseSchedule.startDate, 60, '2026-11-12T16:54:59.000Z')).toBe(
      true,
    )
    expect(isScheduleCreationMarginValid(baseSchedule.startDate, 60, '2026-11-12T16:55:00.000Z')).toBe(
      false,
    )

    expect(isScheduleTimelineOrderValid(baseSchedule)).toBe(true)
    expect(
      isScheduleTimelineOrderValid({
        ...baseSchedule,
        // Invalid: registration opens BEFORE publication
        publicationMinutesBefore: 600,
        registrationOpenMinutesBefore: 720,
      }),
    ).toBe(false)
  })
})

