import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { changePasswordSchema } from '../../../shared/schemas/auth.ts'
import { users } from '../../db/schema.ts'
import {
  authenticateRequest,
  readValidatedBodyWithZod,
  requireAuth,
} from '../../utils/auth.ts'
import { hashPassword, verifyPassword } from '../../utils/crypto.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    await authenticateRequest(event)
  }
  const auth = requireAuth(event)
  const body = await readValidatedBodyWithZod(event, changePasswordSchema)
  const db = useDb(event)

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, auth.userId), isNull(users.deletedAt)),
  })

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Utente non trovato o disattivato.',
    })
  }

  const isCurrentValid = await verifyPassword(body.currentPassword, user.passwordHash)
  if (!isCurrentValid) {
    throw createError({
      statusCode: 400,
      message: 'La password attuale non è corretta.',
    })
  }

  const newPasswordHash = await hashPassword(body.newPassword)
  const now = new Date().toISOString()

  await db
    .update(users)
    .set({
      passwordHash: newPasswordHash,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(and(eq(users.id, auth.userId), isNull(users.deletedAt)))

  return {
    success: true,
    message: 'Password modificata con successo.',
  }
})
