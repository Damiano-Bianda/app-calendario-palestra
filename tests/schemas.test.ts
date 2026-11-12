import { uuidv7 } from 'uuidv7'
import { describe, expect, it } from 'vitest'
import {
  createClassSchema,
  createRecurringSchedulesSchema,
  createSubscriptionSchema,
  createUserSchema,
  loginSchema,
  validateScheduleForCreation,
  validateUserSubscriptionModification,
} from '../shared/schemas'

describe('Shared Zod Schemas & Business Guards (shared/schemas/*)', () => {
  it('validates course creation with default black color and rejects empty/whitespace strings with Italian messages', () => {
    const valid = createClassSchema.parse({
      name: 'Pilates Reformer',
    })
    expect(valid.color).toBe('black')

    const invalidEmpty = createClassSchema.safeParse({
      name: '   ',
      color: 'purple',
    })
    expect(invalidEmpty.success).toBe(false)
    if (!invalidEmpty.success) {
      expect(invalidEmpty.error.issues[0]?.message).toContain('non può essere vuoto')
    }

    const invalidDesc = createClassSchema.safeParse({
      name: 'Yoga',
      description: '   ',
    })
    expect(invalidDesc.success).toBe(false)
  })

  it('validates user creation including E.164 phone number and email format', () => {
    const validUser = createUserSchema.safeParse({
      name: 'Giulia',
      surname: 'Verdi',
      phoneNumber: '+393401234567',
      email: 'giulia.verdi@example.com',
    })
    expect(validUser.success).toBe(true)

    const invalidPhone = createUserSchema.safeParse({
      name: 'Giulia',
      surname: 'Verdi',
      phoneNumber: '+39-340-123',
      email: 'giulia.verdi@example.com',
    })
    expect(invalidPhone.success).toBe(false)
    if (!invalidPhone.success) {
      expect(invalidPhone.error.issues[0]?.message).toContain('E.164')
    }
  })

  it('validates recurring schedule creation and enforces 5-minute steps, spot bounds, and offset order', () => {
    const classId = uuidv7()

    const validRecurring = createRecurringSchedulesSchema.safeParse({
      classId,
      rangeStartDate: '2026-11-15',
      rangeEndDate: '2026-12-15',
      daysOfWeek: [1, 3, 5],
      startTime: '18:30',
      durationMinutes: 45,
      minimumSpots: 4,
      availableSpots: 12,
      publicationMinutesBefore: 1440,
      registrationOpenMinutesBefore: 720,
      registrationCloseMinutesBefore: 60,
    })
    expect(validRecurring.success).toBe(true)

    // Invalid: startTime not a multiple of 5 minutes, availableSpots < minimumSpots
    const invalidRecurring = createRecurringSchedulesSchema.safeParse({
      classId,
      rangeStartDate: '2026-11-15',
      rangeEndDate: '2026-12-15',
      daysOfWeek: [1],
      startTime: '18:33',
      durationMinutes: 45,
      minimumSpots: 10,
      availableSpots: 5,
    })
    expect(invalidRecurring.success).toBe(false)
  })

  it('validates schedule creation 5-minute margin and timeline ordering', () => {
    const classId = uuidv7()
    const centerId = uuidv7()

    const validCreation = validateScheduleForCreation(
      {
        classId,
        centerId,
        startDate: '2026-11-20T18:00:00.000Z',
        durationMinutes: 60,
        minimumSpots: 3,
        availableSpots: 10,
        publicationMinutesBefore: 1440,
        registrationOpenMinutesBefore: 720,
        registrationCloseMinutesBefore: 60,
        createdAt: '2026-11-12T10:00:00.000Z',
      },
      '2026-11-12T10:00:00.000Z',
    )
    expect(validCreation.success).toBe(true)

    // Fails 5-minute margin when registration closes in 4 minutes
    const tooCloseCreation = validateScheduleForCreation(
      {
        classId,
        centerId,
        startDate: '2026-11-20T18:00:00.000Z',
        durationMinutes: 60,
        minimumSpots: 3,
        availableSpots: 10,
        publicationMinutesBefore: null,
        registrationOpenMinutesBefore: null,
        registrationCloseMinutesBefore: 60, // closes at 17:00Z
        createdAt: '2026-11-20T10:00:00.000Z',
      },
      '2026-11-20T16:56:00.000Z',
    )
    expect(tooCloseCreation.success).toBe(false)
  })

  it('validates subscription template creation and user subscription modification guards', () => {
    const c1 = uuidv7()
    const validSub = createSubscriptionSchema.safeParse({
      name: '10 Ingressi Corsi',
      entrances: 10,
      durationDays: 90,
      classIds: [c1],
    })
    expect(validSub.success).toBe(true)

    const noClassesSub = createSubscriptionSchema.safeParse({
      name: 'Abbonamento Vuoto',
      entrances: null,
      durationDays: 30,
      classIds: [],
    })
    expect(noClassesSub.success).toBe(false)

    // User subscription modification guard: cannot set newEntrances < usedEntrances or newEndDate < booked lesson
    const guardFailEntrances = validateUserSubscriptionModification({
      startDate: '2026-11-01T00:00:00.000Z',
      newEndDate: '2026-12-01T00:00:00.000Z',
      newEntrances: 3,
      usedEntrances: 5,
      bookedScheduleStartDates: ['2026-11-15T18:00:00.000Z'],
    })
    expect(guardFailEntrances.valid).toBe(false)

    const guardFailEndDate = validateUserSubscriptionModification({
      startDate: '2026-11-01T00:00:00.000Z',
      newEndDate: '2026-11-14T00:00:00.000Z',
      newEntrances: 10,
      usedEntrances: 5,
      bookedScheduleStartDates: ['2026-11-15T18:00:00.000Z'],
    })
    expect(guardFailEndDate.valid).toBe(false)

    const guardSuccess = validateUserSubscriptionModification({
      startDate: '2026-11-01T00:00:00.000Z',
      newEndDate: '2026-11-20T00:00:00.000Z',
      newEntrances: 5,
      usedEntrances: 5,
      bookedScheduleStartDates: ['2026-11-15T18:00:00.000Z'],
    })
    expect(guardSuccess.valid).toBe(true)

    // Login schema check
    expect(loginSchema.safeParse({ email: 'mario@palestra.it', password: 'Secret' }).success).toBe(
      true,
    )
  })
})

