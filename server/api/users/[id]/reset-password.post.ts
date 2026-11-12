import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { users, usersCenters } from '../../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam, useAppUrl } from '../../../utils/auth.ts'
import { generateRandomPassword, hashPassword } from '../../../utils/crypto.ts'
import { useDb } from '../../../utils/db.ts'
import { sendAdminPasswordResetEmail } from '../../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const targetUserId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: usersCenters.name,
      surname: usersCenters.surname,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.userId, targetUserId),
        eq(usersCenters.centerId, auth.centerId),
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const targetUser = rows[0]
  if (!targetUser) {
    throw createError({
      statusCode: 404,
      message: 'Utente non trovato nella sede attiva.',
    })
  }

  const newPassword = generateRandomPassword(12)
  const newPasswordHash = await hashPassword(newPassword)

  await db
    .update(users)
    .set({
      passwordHash: newPasswordHash,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(eq(users.id, targetUserId))

  await sendAdminPasswordResetEmail(event, {
    to: targetUser.email,
    name: targetUser.name,
    surname: targetUser.surname,
    centerName: auth.centerName,
    newPassword,
    loginUrl: `${useAppUrl(event)}/login`,
  })

  return {
    success: true,
  }
})

