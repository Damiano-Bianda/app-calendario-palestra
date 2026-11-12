import { describe, expect, it } from 'vitest'
import {
  calculateRemainingEntrances,
  countUsedEntrances,
  doesUserScheduleConsumeEntrance,
  selectBestUserSubscriptionForSchedule,
  type UserScheduleForEntranceCalculation,
} from '../shared/utils/subscription-entrances'

describe('User Subscription Remaining Entrances & Eligibility (shared/utils/subscription-entrances.ts)', () => {
  it('returns null when userSubscription.entrances is null (unlimited entrances)', () => {
    const rows: UserScheduleForEntranceCalculation[] = [
      { isQueued: false, deletedAt: null, scheduleStatus: 'ENROLLING' },
      { isQueued: false, deletedAt: null, scheduleStatus: 'COMPLETED' },
    ]
    expect(calculateRemainingEntrances({ id: 'sub-1', entrances: null }, rows)).toBeNull()
  })

  it('accurately counts used entrances and subtracts them from total entrances per SPECIFICATION.md line 370', () => {
    const rows: UserScheduleForEntranceCalculation[] = [
      // 1. Active enrolled in ENROLLING -> CONSUMES (1)
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'ENROLLING',
      },
      // 2. Active enrolled in UPCOMING -> CONSUMES (2)
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'UPCOMING',
      },
      // 3. Active enrolled in ACTIVE -> CONSUMES (3)
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'ACTIVE',
      },
      // 4. Active enrolled in COMPLETED -> CONSUMES (4)
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'COMPLETED',
      },
      // 5. Queued while lesson is still ENROLLING -> CONSUMES (5)
      {
        userSubscriptionId: 'sub-1',
        isQueued: true,
        deletedAt: null,
        scheduleStatus: 'ENROLLING',
      },
      // 6. Queued after registration closed (UPCOMING / ACTIVE / COMPLETED) -> EXCLUDED
      {
        userSubscriptionId: 'sub-1',
        isQueued: true,
        deletedAt: null,
        scheduleStatus: 'UPCOMING',
      },
      {
        userSubscriptionId: 'sub-1',
        isQueued: true,
        deletedAt: null,
        scheduleStatus: 'ACTIVE',
      },
      {
        userSubscriptionId: 'sub-1',
        isQueued: true,
        deletedAt: null,
        scheduleStatus: 'COMPLETED',
      },
      // 7. Lesson cancelled by provider -> EXCLUDED
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'CANCELLED_BY_PROVIDER',
      },
      // 8. Lesson cancelled for low enrollment -> EXCLUDED
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'CANCELLED_LOW_ENROLLMENT',
      },
      // 9. Soft-deleted enrollment (unenrolled) -> EXCLUDED
      {
        userSubscriptionId: 'sub-1',
        isQueued: false,
        deletedAt: '2026-11-11T10:00:00.000Z',
        scheduleStatus: 'ENROLLING',
      },
      // 10. Belongs to a different subscription -> EXCLUDED when filtering by sub-1
      {
        userSubscriptionId: 'sub-2',
        isQueued: false,
        deletedAt: null,
        scheduleStatus: 'ENROLLING',
      },
    ]

    expect(countUsedEntrances(rows, { userSubscriptionId: 'sub-1' })).toBe(5)
    expect(calculateRemainingEntrances({ id: 'sub-1', entrances: 10 }, rows)).toBe(5)
  })

  it('computes schedule status on the fly when schedule object is provided instead of scheduleStatus', () => {
    const schedule = {
      createdAt: '2026-11-10T10:00:00.000Z',
      startDate: '2026-11-12T18:00:00.000Z',
      durationMinutes: 60,
      availableSpots: 10,
      minimumSpots: 3,
      publicationMinutesBefore: null,
      registrationOpenMinutesBefore: null,
      registrationCloseMinutesBefore: 60,
      deletedAt: null,
    }

    // While ENROLLING (12:00Z), a queued row consumes an entrance
    expect(
      doesUserScheduleConsumeEntrance(
        {
          isQueued: true,
          deletedAt: null,
          schedule,
          scheduleEnrolledCount: 10,
        },
        '2026-11-12T12:00:00.000Z',
      ),
    ).toBe(true)

    // Once UPCOMING (17:30Z), a queued row no longer consumes an entrance (returned automatically)
    expect(
      doesUserScheduleConsumeEntrance(
        {
          isQueued: true,
          deletedAt: null,
          schedule,
          scheduleEnrolledCount: 10,
        },
        '2026-11-12T17:30:00.000Z',
      ),
    ).toBe(false)
  })

  it('selects the eligible user subscription that expires first for a lesson (SPECIFICATION.md line 196)', () => {
    const classYoga = '01932000-0000-7000-8000-000000000001'
    const classPilates = '01932000-0000-7000-8000-000000000002'
    const lessonStart = '2026-11-15T17:00:00.000Z'

    const candidates = [
      // Unlimited expiration, valid
      {
        id: 'sub-unlimited-date',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: null,
        entrances: 10,
        remainingEntrances: 5,
        enabledClassIds: [classYoga],
        deletedAt: null,
      },
      // Expires later (Dec 31), valid
      {
        id: 'sub-expires-later',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.000Z',
        entrances: 10,
        remainingEntrances: 3,
        enabledClassIds: [classYoga],
        deletedAt: null,
      },
      // Expires sooner (Nov 20), valid -> MUST BE CHOSEN
      {
        id: 'sub-expires-sooner',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-20T23:59:59.000Z',
        entrances: 10,
        remainingEntrances: 1,
        enabledClassIds: [classYoga],
        deletedAt: null,
      },
      // Expires even sooner (Nov 18), but 0 remaining entrances -> ineligible
      {
        id: 'sub-no-entrances',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-18T23:59:59.000Z',
        entrances: 10,
        remainingEntrances: 0,
        enabledClassIds: [classYoga],
        deletedAt: null,
      },
      // Different class -> ineligible
      {
        id: 'sub-wrong-class',
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2026-11-16T23:59:59.000Z',
        entrances: null,
        remainingEntrances: null,
        enabledClassIds: [classPilates],
        deletedAt: null,
      },
    ]

    const best = selectBestUserSubscriptionForSchedule(candidates, classYoga, lessonStart)
    expect(best?.id).toBe('sub-expires-sooner')
  })
})

