import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { resetPasswordSchema } from '../../../shared/schemas/auth.ts'
import { users } from '../../db/schema.ts'
import { readValidatedBodyWithZod, useAuthSecret } from '../../utils/auth.ts'
import {
  getPasswordHashTail,
  hashPassword,
  verifyRecoveryToken,
} from '../../utils/crypto.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBodyWithZod(event, resetPasswordSchema)
  const secret = useAuthSecret(event)

  const payload = await verifyRecoveryToken(body.token, secret)
  if (!payload) {
    throw createError({
      statusCode: 400,
      message: 'Token di recupero non valido o scaduto.',
    })
  }

  const db = useDb(event)
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, payload.userId), isNull(users.deletedAt)),
  })

  if (!user) {
    throw createError({
      statusCode: 400,
      message: 'Token di recupero non valido o scaduto.',
    })
  }

  // Verify the last 8 characters of the current password_hash match the token
  if (getPasswordHashTail(user.passwordHash) !== payload.passwordHashTail) {
    throw createError({
      statusCode: 400,
      message: 'Token di recupero già utilizzato o non più valido.',
    })
  }

  const newPasswordHash = await hashPassword(body.newPassword)
  const now = new Date().toISOString()

  await db
    .update(users)
    .set({
      passwordHash: newPasswordHash,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(users.id, user.id), isNull(users.deletedAt)))

  return {
    success: true,
    message: 'Password aggiornata con successo.',
  }
})
