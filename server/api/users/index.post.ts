import { and, eq, isNull, sql } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { uuidv7 } from 'uuidv7'
import { createUserSchema } from '../../../shared/schemas/users.ts'
import { users, usersCenters } from '../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  useAppUrl,
} from '../../utils/auth.ts'
import { generateRandomPassword, hashPassword } from '../../utils/crypto.ts'
import { useDb } from '../../utils/db.ts'
import { sendCenterEnabledEmail, sendWelcomeNewUserEmail } from '../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, createUserSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  // Rule (SPECIFICATION.md lines 22, 116):
  // Only the Manager (`is_manager`) can create Assistant Managers (`is_assistant_manager`).
  if (body.isAssistantManager && !auth.isManager) {
    throw createError({
      statusCode: 403,
      message: 'Permessi insufficienti: solo il gerente può creare altri vice gerenti.',
    })
  }

  const normalizedEmail = body.email.trim().toLowerCase()
  const name = body.name.trim()
  const surname = body.surname.trim()
  const phoneNumber = body.phoneNumber.trim()

  // Step 6 (SPECIFICATION.md lines 120-121, 516):
  // Check if an active row (`deleted_at IS NULL`) in `users_centers` already exists for this center and email.
  const existingCenterMembership = await db
    .select({ id: usersCenters.id })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.centerId, auth.centerId),
        sql`LOWER(${users.email}) = ${normalizedEmail}`,
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  if (existingCenterMembership.length > 0) {
    throw createError({
      statusCode: 409,
      message: 'Un utente con questo indirizzo email è già registrato in questa sede.',
    })
  }

  // Step 7 (SPECIFICATION.md lines 122-129, 516):
  // Check if the email already exists as an active account (`deleted_at IS NULL`) in the global `users` table.
  const existingGlobalUsers = await db
    .select()
    .from(users)
    .where(and(sql`LOWER(${users.email}) = ${normalizedEmail}`, isNull(users.deletedAt)))
    .limit(1)

  const existingGlobalUser = existingGlobalUsers[0]
  const loginUrl = `${useAppUrl(event)}/login`

  if (!existingGlobalUser) {
    // Case A: User does NOT exist in `users` -> create in `users` + `users_centers` and send welcome email with random password
    const newUserId = uuidv7()
    const membershipId = uuidv7()
    const temporaryPassword = generateRandomPassword(12)
    const passwordHash = await hashPassword(temporaryPassword)

    const newUserRow = {
      id: newUserId,
      email: normalizedEmail,
      passwordHash,
      createdBy: auth.userId,
      updatedBy: auth.userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    const newMembershipRow = {
      id: membershipId,
      centerId: auth.centerId,
      userId: newUserId,
      name,
      surname,
      phoneNumber,
      isManager: false,
      isAssistantManager: Boolean(body.isAssistantManager),
      isInstructor: Boolean(body.isInstructor),
      createdBy: auth.userId,
      updatedBy: auth.userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    await db.batch([
      db.insert(users).values(newUserRow),
      db.insert(usersCenters).values(newMembershipRow),
    ])

    await sendWelcomeNewUserEmail(event, {
      to: normalizedEmail,
      name,
      surname,
      centerName: auth.centerName,
      temporaryPassword,
      loginUrl,
    })

    return {
      user: {
        id: newUserId,
        membershipId,
        centerId: auth.centerId,
        email: normalizedEmail,
        name,
        surname,
        phoneNumber,
        isManager: false,
        isAssistantManager: newMembershipRow.isAssistantManager,
        isInstructor: newMembershipRow.isInstructor,
        createdAt: now,
        updatedAt: now,
      },
      isNewGlobalAccount: true,
    }
  }

  // Case B: User already exists in `users` -> create `users_centers` row and send informational email
  const membershipId = uuidv7()
  const newMembershipRow = {
    id: membershipId,
    centerId: auth.centerId,
    userId: existingGlobalUser.id,
    name,
    surname,
    phoneNumber,
    isManager: false,
    isAssistantManager: Boolean(body.isAssistantManager),
    isInstructor: Boolean(body.isInstructor),
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  await db.insert(usersCenters).values(newMembershipRow)

  await sendCenterEnabledEmail(event, {
    to: existingGlobalUser.email,
    name,
    surname,
    centerName: auth.centerName,
    loginUrl,
  })

  return {
    user: {
      id: existingGlobalUser.id,
      membershipId,
      centerId: auth.centerId,
      email: existingGlobalUser.email,
      name,
      surname,
      phoneNumber,
      isManager: false,
      isAssistantManager: newMembershipRow.isAssistantManager,
      isInstructor: newMembershipRow.isInstructor,
      createdAt: now,
      updatedAt: now,
    },
    isNewGlobalAccount: false,
  }
})

