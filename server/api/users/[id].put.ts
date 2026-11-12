import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { updateUserProfileSchema } from '../../../shared/schemas/users.ts'
import { users, usersCenters } from '../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const targetUserId = requireUuidParam(event, 'id')
  const body = await readValidatedBodyWithZod(event, updateUserProfileSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  const rows = await db
    .select({
      membership: usersCenters,
      email: users.email,
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

  const found = rows[0]
  if (!found) {
    throw createError({
      statusCode: 404,
      message: 'Utente non trovato nella sede attiva.',
    })
  }

  const nextName = body.name.trim()
  const nextSurname = body.surname.trim()
  const nextPhone = body.phoneNumber.trim()

  await db
    .update(usersCenters)
    .set({
      name: nextName,
      surname: nextSurname,
      phoneNumber: nextPhone,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(eq(usersCenters.id, found.membership.id))

  return {
    user: {
      id: targetUserId,
      membershipId: found.membership.id,
      centerId: auth.centerId,
      email: found.email,
      name: nextName,
      surname: nextSurname,
      phoneNumber: nextPhone,
      isManager: found.membership.isManager,
      isAssistantManager: found.membership.isAssistantManager,
      isInstructor: found.membership.isInstructor,
      createdAt: found.membership.createdAt,
      updatedAt: now,
    },
  }
})

