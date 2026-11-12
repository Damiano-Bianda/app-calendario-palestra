import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { subscriptions, usersSubscriptions } from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedUserSubscriptionMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const subscriptionId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, subscriptionId),
      eq(subscriptions.centerId, auth.centerId),
      isNull(subscriptions.deletedAt),
    ),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Abbonamento non trovato.',
    })
  }

  // Guard (SPECIFICATION.md lines 174-175, 487):
  // Check if there are any active user subscriptions in `users_subscriptions` for this template.
  const userSubRows = await db
    .select()
    .from(usersSubscriptions)
    .where(
      and(
        eq(usersSubscriptions.subscriptionId, subscriptionId),
        eq(usersSubscriptions.centerId, auth.centerId),
        isNull(usersSubscriptions.deletedAt),
      ),
    )

  const computedUserSubs = await attachComputedUserSubscriptionMetrics(db, userSubRows, now)
  const hasActiveUserSubscription = computedUserSubs.some((us) => us.isActive)

  if (hasActiveUserSubscription) {
    throw createError({
      statusCode: 409,
      message:
        "Impossibile eliminare l'abbonamento: esistono clienti con una sottoscrizione attiva associata a questo abbonamento.",
    })
  }

  await db
    .update(subscriptions)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    })
    .where(eq(subscriptions.id, subscriptionId))

  return {
    success: true,
    id: subscriptionId,
  }
})

