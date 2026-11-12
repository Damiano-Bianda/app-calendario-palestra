import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { loginSchema } from '../../../shared/schemas/auth.ts'
import { users } from '../../db/schema.ts'
import {
  getActiveUserCenters,
  readValidatedBodyWithZod,
  setAuthSessionCookie,
} from '../../utils/auth.ts'
import { verifyPassword } from '../../utils/crypto.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBodyWithZod(event, loginSchema)
  const db = useDb(event)

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, body.email), isNull(users.deletedAt)),
  })

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Credenziali non valide.',
    })
  }

  const isPasswordValid = await verifyPassword(body.password, user.passwordHash)
  if (!isPasswordValid) {
    throw createError({
      statusCode: 401,
      message: 'Credenziali non valide.',
    })
  }

  const memberships = await getActiveUserCenters(db, user.id)
  const activeCenter = memberships[0]

  if (!activeCenter) {
    throw createError({
      statusCode: 403,
      message: 'Nessuna sede attiva associata a questo account.',
    })
  }

  await setAuthSessionCookie(event, {
    userId: user.id,
    centerId: activeCenter.centerId,
  })

  return {
    user: {
      id: user.id,
      email: user.email,
      name: activeCenter.name,
      surname: activeCenter.surname,
      phoneNumber: activeCenter.phoneNumber,
    },
    activeCenterId: activeCenter.centerId,
    activeCenter,
    roles: {
      isManager: activeCenter.isManager,
      isAssistantManager: activeCenter.isAssistantManager,
      isInstructor: activeCenter.isInstructor,
    },
    defaultMode: activeCenter.defaultMode,
    defaultRedirect: activeCenter.defaultRedirect,
    centers: memberships,
  }
})
