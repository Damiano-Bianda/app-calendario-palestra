import { defineEventHandler } from 'h3'
import {
  authenticateRequest,
  getActiveUserCenters,
  requireAuth,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    await authenticateRequest(event)
  }
  const auth = requireAuth(event)
  const db = useDb(event)

  const memberships = await getActiveUserCenters(db, auth.userId)
  const activeCenter =
    memberships.find((m) => m.centerId === auth.centerId) ?? {
      centerId: auth.centerId,
      centerName: auth.centerName,
      timezone: auth.timezone,
      name: auth.name,
      surname: auth.surname,
      phoneNumber: auth.phoneNumber,
      isManager: auth.isManager,
      isAssistantManager: auth.isAssistantManager,
      isInstructor: auth.isInstructor,
      isWorker: auth.isWorker,
      defaultMode: auth.defaultMode,
      defaultRedirect: auth.defaultRedirect,
    }

  return {
    user: {
      id: auth.userId,
      email: auth.email,
      name: auth.name,
      surname: auth.surname,
      phoneNumber: auth.phoneNumber,
    },
    activeCenterId: auth.centerId,
    activeCenter,
    roles: {
      isManager: auth.isManager,
      isAssistantManager: auth.isAssistantManager,
      isInstructor: auth.isInstructor,
    },
    defaultMode: auth.defaultMode,
    defaultRedirect: auth.defaultRedirect,
    centers: memberships,
  }
})

