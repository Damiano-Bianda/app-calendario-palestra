import { z } from 'zod'
import {
  emailSchema,
  nonEmptyStringSchema,
  phoneE164Schema,
  uuidSchema,
} from './common.ts'

/**
 * Schema for `POST /api/users` (user creation/enabling in center, SPECIFICATION.md lines 113-129, 277-289, 516).
 */
export const createUserSchema = z.object({
  name: nonEmptyStringSchema('Il nome', 255),
  surname: nonEmptyStringSchema('Il cognome', 255),
  phoneNumber: phoneE164Schema,
  email: emailSchema,
  isInstructor: z.boolean().optional().default(false),
  isAssistantManager: z.boolean().optional().default(false),
})

export type CreateUserInput = z.infer<typeof createUserSchema>

/**
 * Schema for `PUT /api/users/:id` (user profile modification, SPECIFICATION.md lines 131-137, 517).
 */
export const updateUserProfileSchema = z.object({
  name: nonEmptyStringSchema('Il nome', 255),
  surname: nonEmptyStringSchema('Il cognome', 255),
  phoneNumber: phoneE164Schema,
})

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>

/**
 * Schema for `PUT /api/users/:id/roles` (user roles modification, SPECIFICATION.md lines 139-145, 518).
 */
export const updateUserRolesSchema = z.object({
  isInstructor: z.boolean({ message: 'Il flag istruttore deve essere un booleano.' }),
  isAssistantManager: z
    .boolean({ message: 'Il flag vice gerente deve essere un booleano.' })
    .optional(),
})

export type UpdateUserRolesInput = z.infer<typeof updateUserRolesSchema>

/**
 * Schema for `POST /api/users/email` (sending email to one or more customers, SPECIFICATION.md lines 23, 398-399, 520).
 */
export const sendUsersEmailSchema = z.object({
  userIds: z
    .array(uuidSchema, { message: 'Selezionare almeno un destinatario.' })
    .min(1, { message: 'Selezionare almeno un destinatario.' })
    .transform((ids) => Array.from(new Set(ids))),
  subject: nonEmptyStringSchema("L'oggetto dell'email", 255).optional(),
  message: nonEmptyStringSchema('Il messaggio email', 2000),
})

export type SendUsersEmailInput = z.infer<typeof sendUsersEmailSchema>

