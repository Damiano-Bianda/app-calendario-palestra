import { createError, defineEventHandler } from 'h3'
import { changeCenterSchema } from '../../../shared/schemas/auth.ts'
import {
  authenticateRequest,
  getActiveUserCenters,
  readValidatedBodyWithZod,
  requireAuth,
  setAuthSessionCookie,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    await authenticateRequest(event)
  }
  const auth = requireAuth(event)
  const body = await readValidatedBodyWithZod(event, changeCenterSchema)
  const db = useDb(event)

  const memberships = await getActiveUserCenters(db, auth.userId)
  const targetMembership = memberships.find((m) => m.centerId === body.centerId)

  if (!targetMembership) {
    throw createError({
      statusCode: 403,
      message: 'Non appartieni alla sede selezionata o la sede non è attiva.',
    })
  }

  await setAuthSessionCookie(event, {
    userId: auth.userId,
    centerId: targetMembership.centerId,
  })

  event.context.auth = {
    userId: auth.userId,
    email: auth.email,
    centerId: targetMembership.centerId,
    centerName: targetMembership.centerName,
    timezone: targetMembership.timezone,
    name: targetMembership.name,
    surname: targetMembership.surname,
    phoneNumber: targetMembership.phoneNumber,
    isManager: targetMembership.isManager,
    isAssistantManager: targetMembership.isAssistantManager,
    isInstructor: targetMembership.isInstructor,
    isWorker: targetMembership.isWorker,
    defaultMode: targetMembership.defaultMode,
    defaultRedirect: targetMembership.defaultRedirect,
  }

  return {
    success: true,
    activeCenterId: targetMembership.centerId,
    activeCenter: targetMembership,
    roles: {
      isManager: targetMembership.isManager,
      isAssistantManager: targetMembership.isAssistantManager,
      isInstructor: targetMembership.isInstructor,
    },
    defaultMode: targetMembership.defaultMode,
    defaultRedirect: targetMembership.defaultRedirect,
    centers: memberships,
  }
})
