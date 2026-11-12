import { and, desc, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler, getQuery } from 'h3'
import { subscriptions, users, usersCenters, usersSubscriptions } from '../../db/schema.ts'
import { requireAuth } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedUserSubscriptionMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = useDb(event)
  const query = getQuery(event)
  const now = new Date().toISOString()

  const requestedUserId =
    typeof query.userId === 'string' && query.userId.trim().length > 0
      ? query.userId.trim()
      : typeof query.user === 'string' && query.user.trim().length > 0
        ? query.user.trim()
        : undefined

  const requestedSubscriptionId =
    typeof query.subscriptionId === 'string' && query.subscriptionId.trim().length > 0
      ? query.subscriptionId.trim()
      : undefined

  // Non-worker customers can only query their own subscriptions
  if (!auth.isWorker && requestedUserId && requestedUserId !== auth.userId) {
    throw createError({
      statusCode: 403,
      message: 'Non hai i permessi per visualizzare le sottoscrizioni di altri utenti.',
    })
  }

  const effectiveUserId = auth.isWorker ? requestedUserId : auth.userId

  const conditions = [
    eq(usersSubscriptions.centerId, auth.centerId),
    isNull(usersSubscriptions.deletedAt),
    isNull(users.deletedAt),
    isNull(usersCenters.deletedAt),
  ]

  if (effectiveUserId) {
    conditions.push(eq(usersSubscriptions.userId, effectiveUserId))
  }
  if (requestedSubscriptionId) {
    conditions.push(eq(usersSubscriptions.subscriptionId, requestedSubscriptionId))
  }

  const rows = await db
    .select({
      userSub: usersSubscriptions,
      subscription: {
        id: subscriptions.id,
        name: subscriptions.name,
        description: subscriptions.description,
        entrances: subscriptions.entrances,
        durationDays: subscriptions.durationDays,
      },
      user: {
        id: users.id,
        email: users.email,
        name: usersCenters.name,
        surname: usersCenters.surname,
        phoneNumber: usersCenters.phoneNumber,
      },
    })
    .from(usersSubscriptions)
    .innerJoin(subscriptions, eq(usersSubscriptions.subscriptionId, subscriptions.id))
    .innerJoin(users, eq(usersSubscriptions.userId, users.id))
    .innerJoin(
      usersCenters,
      and(
        eq(usersCenters.userId, users.id),
        eq(usersCenters.centerId, usersSubscriptions.centerId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(usersSubscriptions.startDate), desc(usersSubscriptions.createdAt))

  const rawSubs = rows.map((r) => r.userSub)
  const computedSubs = await attachComputedUserSubscriptionMetrics(db, rawSubs, now)
  const metricsById = new Map(computedSubs.map((s) => [s.id, s]))

  let result = rows.map((r) => {
    const metrics = metricsById.get(r.userSub.id)!
    return {
      ...r.userSub,
      usedEntrances: metrics.usedEntrances,
      remainingEntrances: metrics.remainingEntrances,
      isActive: metrics.isActive,
      subscription: r.subscription,
      user: r.user,
    }
  })

  if (query.activeOnly === 'true') {
    result = result.filter((r) => r.isActive)
  } else if (query.activeOnly === 'false') {
    result = result.filter((r) => !r.isActive)
  }

  return {
    userSubscriptions: result,
  }
})
