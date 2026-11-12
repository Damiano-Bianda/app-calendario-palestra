import { defineEventHandler } from 'h3'
import {
  authenticateRequest,
  clearAuthSessionCookie,
  requireAuth,
} from '../../utils/auth.ts'

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    await authenticateRequest(event)
  }
  requireAuth(event)
  clearAuthSessionCookie(event)

  return {
    success: true,
    message: 'Disconnessione effettuata con successo.',
  }
})

