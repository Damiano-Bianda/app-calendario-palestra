import { and, asc, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { classes, subscriptions, subscriptionsClasses } from '../../db/schema.ts'
import { requireUuidParam, requireWorker } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const subscriptionId = requireUuidParam(event, 'id')
  const db = useDb(event)

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, subscriptionId),
      eq(subscriptions.centerId, auth.centerId),
      isNull(subscriptions.deletedAt),
    ),
  })

  if (!sub) {
    throw createError({
      statusCode: 404,
      message: 'Abbonamento non trovato.',
    })
  }

  const associatedClasses = await db
    .select({
      id: classes.id,
      name: classes.name,
      color: classes.color,
    })
    .from(subscriptionsClasses)
    .innerJoin(classes, eq(subscriptionsClasses.classId, classes.id))
    .where(
      and(
        eq(subscriptionsClasses.subscriptionId, subscriptionId),
        isNull(subscriptionsClasses.deletedAt),
        isNull(classes.deletedAt),
      ),
    )
    .orderBy(asc(classes.name))

  return {
    subscription: {
      ...sub,
      classes: associatedClasses,
      classIds: associatedClasses.map((c) => c.id),
    },
  }
})

