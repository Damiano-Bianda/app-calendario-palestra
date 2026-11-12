import { z } from 'zod'
import {
  classColorSchema,
  nonEmptyStringSchema,
  nullableNonEmptyStringSchema,
} from './common.ts'

/**
 * Schema for `POST /api/classes` (course creation, SPECIFICATION.md lines 71-78, 291-300, 449).
 */
export const createClassSchema = z.object({
  name: nonEmptyStringSchema('Il nome del corso', 255),
  color: classColorSchema,
  description: nullableNonEmptyStringSchema('La descrizione', 1000),
})

export type CreateClassInput = z.infer<typeof createClassSchema>

/**
 * Schema for `PUT /api/classes/:id` (course update, SPECIFICATION.md lines 80-84, 450).
 */
export const updateClassSchema = z.object({
  name: nonEmptyStringSchema('Il nome del corso', 255),
  color: classColorSchema,
  description: nullableNonEmptyStringSchema('La descrizione', 1000),
  notifyEnrolled: z.boolean().optional().default(false),
  notificationMessage: nullableNonEmptyStringSchema('Il messaggio opzionale', 2000),
})

export type UpdateClassInput = z.infer<typeof updateClassSchema>

