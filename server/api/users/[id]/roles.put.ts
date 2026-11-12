import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { updateUserRolesSchema } from '../../../../shared/schemas/users.ts'
import { NON_TERMINATED_SCHEDULE_STATUSES } from '../../../../shared/utils/schedule-status.ts'
import { schedules, users, usersCenters } from '../../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../../utils/auth.ts'
import { useDb } from '../../../utils/db.ts'
import { attachComputedScheduleMetrics } from '../../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const targetUserId = requireUuidParam(event, 'id')
  const body = await readValidatedBodyWithZod(event, updateUserRolesSchema)
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

  // Rule (SPECIFICATION.md lines 22, 518):
  // Only the Manager (`auth.isManager`) can change `is_assistant_manager`.
  if (
    body.isAssistantManager !== undefined &&
    body.isAssistantManager !== found.membership.isAssistantManager &&
    !auth.isManager
  ) {
    throw createError({
      statusCode: 403,
      message: 'Permessi insufficienti: solo il gerente può modificare il ruolo di vice gerente.',
    })
  }

  const nextIsAssistantManager =
    auth.isManager && body.isAssistantManager !== undefined
      ? body.isAssistantManager
      : found.membership.isAssistantManager

  // Guard (SPECIFICATION.md lines 143-144, 518):
  // Block removing `is_instructor` if the user has assigned lessons in DRAFT, PUBLISHED, ENROLLING, UPCOMING, or ACTIVE status.
  if (found.membership.isInstructor && !body.isInstructor) {
    const instructorSchedules = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.instructorId, targetUserId),
          eq(schedules.centerId, auth.centerId),
          isNull(schedules.deletedAt),
        ),
      )

    const computedSchedules = await attachComputedScheduleMetrics(db, instructorSchedules, now)
    const hasNonTerminatedSchedules = computedSchedules.some((s) =>
      NON_TERMINATED_SCHEDULE_STATUSES.includes(s.status),
    )

    if (hasNonTerminatedSchedules) {
      throw createError({
        statusCode: 409,
        message:
          "Impossibile rimuovere il ruolo di istruttore: l'utente ha lezioni assegnate in stato bozza, pubblicata, iscrizioni aperte, in partenza o in corso.",
      })
    }
  }

  await db
    .update(usersCenters)
    .set({
      isInstructor: body.isInstructor,
      isAssistantManager: nextIsAssistantManager,
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
      name: found.membership.name,
      surname: found.membership.surname,
      phoneNumber: found.membership.phoneNumber,
      isManager: found.membership.isManager,
      isAssistantManager: nextIsAssistantManager,
      isInstructor: body.isInstructor,
      createdAt: found.membership.createdAt,
      updatedAt: now,
    },
  }
})

