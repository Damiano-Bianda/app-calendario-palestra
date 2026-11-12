import { z } from 'zod'
import {
  isScheduleCreationMarginValid,
  isScheduleTimelineOrderValid,
} from '../utils/schedule-status.ts'
import {
  localDateStringSchema,
  localTimeFiveMinStepSchema,
  nonEmptyStringSchema,
  nullableNonEmptyStringSchema,
  utcIsoDateStringSchema,
  utcIsoFiveMinStepSchema,
  uuidSchema,
} from './common.ts'

export const durationMinutesSchema = z
  .number({ message: 'La durata in minuti è obbligatoria.' })
  .int({ message: 'La durata deve essere un numero intero di minuti.' })
  .min(5, { message: 'La durata minima della lezione è di 5 minuti.' })
  .refine((val) => val % 5 === 0, {
    message: 'La durata deve avere incrementi di 5 minuti.',
  })

export const minimumSpotsSchema = z
  .number({ message: 'Il numero minimo di posti è obbligatorio.' })
  .int({ message: 'Il numero minimo di posti deve essere un numero intero.' })
  .min(1, { message: 'Il numero minimo di posti deve essere almeno 1.' })

export const availableSpotsSchema = z
  .number({ message: 'Il numero massimo di posti deve essere un numero.' })
  .int({ message: 'Il numero massimo di posti deve essere un numero intero.' })
  .min(1, { message: 'Il numero massimo di posti deve essere almeno 1.' })
  .nullable()
  .optional()
  .transform((val) => val ?? null)

export const publicationMinutesBeforeSchema = z
  .number({ message: "I minuti di preavviso per la pubblicazione devono essere un numero." })
  .int({ message: 'I minuti di pubblicazione devono essere un numero intero.' })
  .min(1, { message: 'I minuti di pubblicazione devono essere almeno 1.' })
  .refine((val) => val % 5 === 0, {
    message: 'I minuti prima della pubblicazione devono avere incrementi di 5 minuti.',
  })
  .nullable()
  .optional()
  .transform((val) => val ?? null)

export const registrationOpenMinutesBeforeSchema = z
  .number({ message: "I minuti di apertura iscrizioni devono essere un numero." })
  .int({ message: 'I minuti di apertura iscrizioni devono essere un numero intero.' })
  .min(1, { message: 'I minuti di apertura iscrizioni devono essere almeno 1.' })
  .refine((val) => val % 5 === 0, {
    message: "I minuti prima dell'apertura iscrizioni devono avere incrementi di 5 minuti.",
  })
  .nullable()
  .optional()
  .transform((val) => val ?? null)

export const registrationCloseMinutesBeforeSchema = z
  .number({ message: 'I minuti di chiusura iscrizioni devono essere un numero.' })
  .int({ message: 'I minuti di chiusura iscrizioni devono essere un numero intero.' })
  .min(1, { message: 'I minuti di chiusura iscrizioni devono essere almeno 1.' })
  .nullable()
  .optional()
  .transform((val) => val ?? null)

export const dayOfWeekSchema = z
  .number({ message: 'Giorno della settimana non valido.' })
  .int()
  .min(0, { message: 'Il giorno della settimana deve essere compreso tra 0 (Domenica) e 6 (Sabato).' })
  .max(6, { message: 'Il giorno della settimana deve essere compreso tra 0 (Domenica) e 6 (Sabato).' })

function addScheduleSpotsAndOffsetsRefinements<
  T extends {
    minimumSpots: number
    availableSpots: number | null
    publicationMinutesBefore: number | null
    registrationOpenMinutesBefore: number | null
    registrationCloseMinutesBefore: number | null
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.availableSpots !== null && data.availableSpots < data.minimumSpots) {
    ctx.addIssue({
      code: 'custom',
      path: ['availableSpots'],
      message: 'Il numero di posti massimi deve essere maggiore o uguale al numero di posti minimi.',
    })
  }

  if (
    data.publicationMinutesBefore !== null &&
    data.registrationOpenMinutesBefore === null
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['registrationOpenMinutesBefore'],
      message:
        "Le iscrizioni non possono essere subito aperte se la lezione ha un orario di pubblicazione posticipato.",
    })
  }

  if (
    data.publicationMinutesBefore !== null &&
    data.registrationOpenMinutesBefore !== null &&
    data.publicationMinutesBefore < data.registrationOpenMinutesBefore
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['registrationOpenMinutesBefore'],
      message:
        "L'apertura delle iscrizioni non può precedere la pubblicazione della lezione.",
    })
  }

  if (
    data.registrationOpenMinutesBefore !== null &&
    data.registrationCloseMinutesBefore !== null &&
    data.registrationOpenMinutesBefore < data.registrationCloseMinutesBefore
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['registrationCloseMinutesBefore'],
      message:
        "La chiusura delle iscrizioni non può precedere l'apertura delle iscrizioni.",
    })
  }

  if (
    data.publicationMinutesBefore !== null &&
    data.registrationCloseMinutesBefore !== null &&
    data.publicationMinutesBefore < data.registrationCloseMinutesBefore
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['registrationCloseMinutesBefore'],
      message:
        'La chiusura delle iscrizioni non può precedere la pubblicazione della lezione.',
    })
  }
}

/**
 * Schema for `POST /api/schedules` (recurring schedule creation, SPECIFICATION.md lines 92-97, 468).
 */
export const createRecurringSchedulesSchema = z
  .object({
    classId: uuidSchema,
    rangeStartDate: localDateStringSchema,
    rangeEndDate: localDateStringSchema,
    daysOfWeek: z
      .array(dayOfWeekSchema, { message: 'Selezionare almeno un giorno della settimana.' })
      .min(1, { message: 'Selezionare almeno un giorno della settimana.' })
      .transform((days) => Array.from(new Set(days)).sort((a, b) => a - b)),
    startTime: localTimeFiveMinStepSchema,
    durationMinutes: durationMinutesSchema,
    minimumSpots: minimumSpotsSchema,
    availableSpots: availableSpotsSchema,
    instructorId: uuidSchema.nullable().optional().transform((val) => val ?? null),
    publicationMinutesBefore: publicationMinutesBeforeSchema,
    registrationOpenMinutesBefore: registrationOpenMinutesBeforeSchema,
    registrationCloseMinutesBefore: registrationCloseMinutesBeforeSchema,
  })
  .superRefine((data, ctx) => {
    if (data.rangeEndDate < data.rangeStartDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['rangeEndDate'],
        message: 'La data di fine non può essere precedente alla data di inizio.',
      })
    }
    addScheduleSpotsAndOffsetsRefinements(data, ctx)
  })

export type CreateRecurringSchedulesInput = z.infer<typeof createRecurringSchedulesSchema>

/**
 * Schema for validating a single schedule instance with its UTC `startDate` and `createdAt`,
 * enforcing the full timeline ordering rule from SPECIFICATION.md (lines 301-335).
 */
export const scheduleInstanceSchema = z
  .object({
    classId: uuidSchema,
    centerId: uuidSchema,
    instructorId: uuidSchema.nullable().optional().transform((val) => val ?? null),
    startDate: utcIsoFiveMinStepSchema,
    durationMinutes: durationMinutesSchema,
    minimumSpots: minimumSpotsSchema,
    availableSpots: availableSpotsSchema,
    publicationMinutesBefore: publicationMinutesBeforeSchema,
    registrationOpenMinutesBefore: registrationOpenMinutesBeforeSchema,
    registrationCloseMinutesBefore: registrationCloseMinutesBeforeSchema,
    createdAt: utcIsoDateStringSchema,
  })
  .superRefine((data, ctx) => {
    addScheduleSpotsAndOffsetsRefinements(data, ctx)

    if (!isScheduleTimelineOrderValid(data)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message:
          "L'ordine temporale tra creazione, pubblicazione, apertura/chiusura iscrizioni e inizio lezione non è valido.",
      })
    }
  })

export type ScheduleInstanceInput = z.infer<typeof scheduleInstanceSchema>

/**
 * Validates a single schedule instance at creation time, enforcing both the timeline order
 * and the 5-minute creation margin (`start_date - close_offset > now + 5 minutes`, SPECIFICATION.md line 333).
 */
export function validateScheduleForCreation(
  input: z.input<typeof scheduleInstanceSchema>,
  now: string | Date = new Date(),
) {
  const parsed = scheduleInstanceSchema.safeParse(input)
  if (!parsed.success) {
    return parsed
  }

  if (
    !isScheduleCreationMarginValid(
      parsed.data.startDate,
      parsed.data.registrationCloseMinutesBefore,
      now,
    )
  ) {
    return z
      .object({ startDate: z.string() })
      .superRefine((_, ctx) => {
        ctx.addIssue({
          code: 'custom',
          path: ['startDate'],
          message:
            'La chiusura delle iscrizioni della lezione deve avvenire almeno 5 minuti nel futuro rispetto ad ora.',
        })
      })
      .safeParse({ startDate: parsed.data.startDate }) as ReturnType<
      typeof scheduleInstanceSchema.safeParse
    >
  }

  return parsed
}

/**
 * Schema for `PUT /api/schedules/:id` (single schedule update, SPECIFICATION.md lines 107-111, 469).
 */
export const updateScheduleSchema = z
  .object({
    classId: uuidSchema,
    instructorId: uuidSchema.nullable().optional().transform((val) => val ?? null),
    startDate: utcIsoFiveMinStepSchema,
    durationMinutes: durationMinutesSchema,
    minimumSpots: minimumSpotsSchema,
    availableSpots: availableSpotsSchema,
    publicationMinutesBefore: publicationMinutesBeforeSchema,
    registrationOpenMinutesBefore: registrationOpenMinutesBeforeSchema,
    registrationCloseMinutesBefore: registrationCloseMinutesBeforeSchema,
  })
  .superRefine((data, ctx) => {
    addScheduleSpotsAndOffsetsRefinements(data, ctx)
  })

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>

/**
 * Schema for `DELETE /api/schedules/:id` optional notification payload (SPECIFICATION.md lines 99-105, 470).
 */
export const deleteScheduleSchema = z.object({
  notifyEnrolled: z.boolean().optional().default(false),
  notificationMessage: nullableNonEmptyStringSchema('Il messaggio opzionale', 2000),
})

export type DeleteScheduleInput = z.infer<typeof deleteScheduleSchema>

/**
 * Schema for `POST /api/schedules/:id/enroll` (SPECIFICATION.md lines 191-201, 471).
 * `userId` is optional for a customer enrolling themselves, or provided by a manager.
 */
export const enrollScheduleSchema = z.object({
  userId: uuidSchema.optional(),
})

export type EnrollScheduleInput = z.infer<typeof enrollScheduleSchema>

/**
 * Schema for `POST /api/schedules/:id/email` (SPECIFICATION.md lines 30, 473).
 */
export const scheduleEmailSchema = z.object({
  message: nonEmptyStringSchema('Il messaggio email', 2000),
})

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>

