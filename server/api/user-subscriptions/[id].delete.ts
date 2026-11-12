import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { usersSubscriptions } from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedUserSubscriptionMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const userSubId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const existing = await db.query.usersSubscriptions.findFirst({
    where: and(
      eq(usersSubscriptions.id, userSubId),
      eq(usersSubscriptions.centerId, auth.centerId),
      isNull(usersSubscriptions.deletedAt),
    ),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Sottoscrizione non trovata.',
    })
  }

  // Guard (SPECIFICATION.md line 501):
  // Block deletion if the subscription has active/future booked or queued lessons linked to it.
  const [computed] = await attachComputedUserSubscriptionMetrics(db, [existing], now)
  if (computed?.hasActiveOrQueuedFutureSchedules) {
    throw createError({
      statusCode: 409,
      message:
        'Impossibile eliminare la sottoscrizione: esistono lezioni attive o in coda future collegate a questa sottoscrizione.',
    })
  }

  await db
    .update(usersSubscriptions)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(eq(usersSubscriptions.id, userSubId))

  return {
    success: true,
    id: userSubId,
  }
})

