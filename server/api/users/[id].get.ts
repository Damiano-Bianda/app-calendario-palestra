import { and, desc, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { subscriptions, users, usersCenters, usersSubscriptions } from '../../db/schema.ts'
import { requireUuidParam, requireWorker } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedUserSubscriptionMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const targetUserId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const userRows = await db
    .select({
      id: users.id,
      membershipId: usersCenters.id,
      centerId: usersCenters.centerId,
      email: users.email,
      name: usersCenters.name,
      surname: usersCenters.surname,
      phoneNumber: usersCenters.phoneNumber,
      isManager: usersCenters.isManager,
      isAssistantManager: usersCenters.isAssistantManager,
      isInstructor: usersCenters.isInstructor,
      createdAt: usersCenters.createdAt,
      updatedAt: usersCenters.updatedAt,
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

  const targetUser = userRows[0]
  if (!targetUser) {
    throw createError({
      statusCode: 404,
      message: 'Utente non trovato nella sede attiva.',
    })
  }

  const subRows = await db
    .select({
      userSub: usersSubscriptions,
      subscription: {
        id: subscriptions.id,
        name: subscriptions.name,
        description: subscriptions.description,
        entrances: subscriptions.entrances,
        durationDays: subscriptions.durationDays,
      },
    })
    .from(usersSubscriptions)
    .innerJoin(subscriptions, eq(usersSubscriptions.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(usersSubscriptions.userId, targetUserId),
        eq(usersSubscriptions.centerId, auth.centerId),
        isNull(usersSubscriptions.deletedAt),
      ),
    )
    .orderBy(desc(usersSubscriptions.startDate), desc(usersSubscriptions.createdAt))

  const rawSubs = subRows.map((r) => r.userSub)
  const computedSubs = await attachComputedUserSubscriptionMetrics(db, rawSubs, now)
  const metricsById = new Map(computedSubs.map((s) => [s.id, s]))

  const enrichedSubscriptions = subRows.map((r) => {
    const metrics = metricsById.get(r.userSub.id)!
    return {
      ...r.userSub,
      usedEntrances: metrics.usedEntrances,
      remainingEntrances: metrics.remainingEntrances,
      isActive: metrics.isActive,
      subscription: r.subscription,
    }
  })

  return {
    user: targetUser,
    subscriptions: enrichedSubscriptions,
  }
})

