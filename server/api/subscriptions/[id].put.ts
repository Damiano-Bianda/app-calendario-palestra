import { and, asc, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { updateSubscriptionSchema } from '../../../shared/schemas/subscriptions.ts'
import { classes, subscriptions, subscriptionsClasses } from '../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const subscriptionId = requireUuidParam(event, 'id')
  // updateSubscriptionSchema strictly validates only `name` and `description`
  // and strips any structural fields (`entrances`, `durationDays`, `classIds`) per SPECIFICATION.md line 486.
  const body = await readValidatedBodyWithZod(event, updateSubscriptionSchema)
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

  const nextName = body.name.trim()
  const nextDescription = body.description ? body.description.trim() : null

  await db
    .update(subscriptions)
    .set({
      name: nextName,
      description: nextDescription,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscriptionId))

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
      ...existing,
      name: nextName,
      description: nextDescription,
      updatedBy: auth.userId,
      updatedAt: now,
      classes: associatedClasses,
      classIds: associatedClasses.map((c) => c.id),
    },
  }
})

