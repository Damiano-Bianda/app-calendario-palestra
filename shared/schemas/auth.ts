import { z } from 'zod'
import { emailSchema, nonEmptyStringSchema, uuidSchema } from './common.ts'

/**
 * Schema for `POST /api/auth/login`
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: nonEmptyStringSchema('La password', 255),
})

export type LoginInput = z.infer<typeof loginSchema>

/**
 * Schema for `POST /api/auth/recover`
 */
export const recoverPasswordSchema = z.object({
  email: emailSchema,
})

export type RecoverPasswordInput = z.infer<typeof recoverPasswordSchema>

/**
 * Schema for `POST /api/auth/reset-password`
 */
export const resetPasswordSchema = z.object({
  token: nonEmptyStringSchema('Il token di recupero', 2048),
  newPassword: z
    .string({ message: 'La nuova password è obbligatoria.' })
    .refine((val) => val.trim().length >= 8, {
      message: 'La nuova password deve contenere almeno 8 caratteri.',
    })
    .refine((val) => val.length <= 255, {
      message: 'La nuova password non può superare 255 caratteri.',
    }),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

/**
 * Schema for `PUT /api/settings/center`
 */
export const changeCenterSchema = z.object({
  centerId: uuidSchema,
})

export type ChangeCenterInput = z.infer<typeof changeCenterSchema>

/**
 * Schema for `PUT /api/settings/password`
 */
export const changePasswordSchema = z.object({
  currentPassword: nonEmptyStringSchema('La password attuale', 255),
  newPassword: z
    .string({ message: 'La nuova password è obbligatoria.' })
    .refine((val) => val.trim().length >= 8, {
      message: 'La nuova password deve contenere almeno 8 caratteri.',
    })
    .refine((val) => val.length <= 255, {
      message: 'La nuova password non può superare 255 caratteri.',
    }),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

