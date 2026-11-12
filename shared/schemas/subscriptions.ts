import { z } from 'zod'
import {
  nonEmptyStringSchema,
  nullableNonEmptyStringSchema,
  utcIsoDateStringSchema,
  uuidSchema,
} from './common.ts'

export const nullablePositiveIntSchema = (fieldLabel: string) =>
  z
    .number({ message: `${fieldLabel} deve essere un numero.` })
    .int({ message: `${fieldLabel} deve essere un numero intero.` })
    .min(1, { message: `${fieldLabel} deve essere almeno 1.` })
    .nullable()
    .optional()
    .transform((val) => val ?? null)

/**
 * Schema for `POST /api/subscriptions` (subscription template creation, SPECIFICATION.md lines 155-162, 347-356, 485).
 */
export const createSubscriptionSchema = z.object({
  name: nonEmptyStringSchema("Il nome dell'abbonamento", 255),
  description: nullableNonEmptyStringSchema('La descrizione', 1000),
  entrances: nullablePositiveIntSchema('Il numero di entrate'),
  durationDays: nullablePositiveIntSchema('La durata in giorni'),
  classIds: z
    .array(uuidSchema, { message: 'Selezionare almeno un corso abilitato.' })
    .min(1, { message: 'Selezionare almeno un corso abilitato.' })
    .transform((ids) => Array.from(new Set(ids))),
})

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>

/**
 * Schema for `PUT /api/subscriptions/:id` (subscription template update: only name & description are editable,
 * SPECIFICATION.md lines 164-170, 486).
 */
export const updateSubscriptionSchema = z.object({
  name: nonEmptyStringSchema("Il nome dell'abbonamento", 255),
  description: nullableNonEmptyStringSchema('La descrizione', 1000),
})

export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>

/**
 * Schema for `POST /api/user-subscriptions` (assigning subscription to a user, SPECIFICATION.md lines 178-182, 499).
 */
export const createUserSubscriptionSchema = z.object({
  userId: uuidSchema,
  subscriptionId: uuidSchema,
  startDate: utcIsoDateStringSchema,
})

export type CreateUserSubscriptionInput = z.infer<typeof createUserSubscriptionSchema>

/**
 * Schema for `PUT /api/user-subscriptions/:id` (updating user subscription expiration and total entrances,
 * SPECIFICATION.md lines 184-189, 358-370, 500).
 */
export const updateUserSubscriptionSchema = z
  .object({
    startDate: utcIsoDateStringSchema.optional(),
    endDate: utcIsoDateStringSchema
      .nullable()
      .optional()
      .transform((val) => val ?? null),
    entrances: nullablePositiveIntSchema('Il numero di entrate totali'),
  })
  .superRefine((data, ctx) => {
    if (
      data.startDate !== undefined &&
      data.endDate !== null &&
      Date.parse(data.endDate) <= Date.parse(data.startDate)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'La data di scadenza deve essere successiva alla data di inizio.',
      })
    }
  })

export type UpdateUserSubscriptionInput = z.infer<typeof updateUserSubscriptionSchema>

/**
 * Validates the business guards for modifying a `users_subscriptions` record
 * (SPECIFICATION.md lines 187-189 & 500):
 * 1) `endDate` (if not null) must be `> startDate`
 * 2) `endDate` (if not null) cannot precede the `start_date` of any lesson in which the user is already enrolled or queued with this subscription
 * 3) `entrances` (if not null) cannot be less than `usedEntrances`
 */
export function validateUserSubscriptionModification(params: {
  startDate: string
  newEndDate: string | null
  newEntrances: number | null
  usedEntrances: number
  bookedScheduleStartDates: ReadonlyArray<string>
}): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = []
  const startMs = Date.parse(params.startDate)

  if (params.newEndDate !== null) {
    const endMs = Date.parse(params.newEndDate)
    if (Number.isNaN(endMs) || endMs <= startMs) {
      errors.push('La data di scadenza deve essere successiva alla data di inizio.')
    } else {
      for (const lessonStart of params.bookedScheduleStartDates) {
        const lessonMs = Date.parse(lessonStart)
        if (!Number.isNaN(lessonMs) && endMs < lessonMs) {
          errors.push(
            'La nuova data di fine è antecedente a lezioni a cui il cliente è già iscritto o in coda.',
          )
          break
        }
      }
    }
  }

  if (params.newEntrances !== null && params.newEntrances < params.usedEntrances) {
    errors.push(
      'Il nuovo numero di entrate totali non può essere inferiore alle entrate già utilizzate.',
    )
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true }
}

