import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { uuidv7 } from 'uuidv7'
import { createSubscriptionSchema } from '../../../shared/schemas/subscriptions.ts'
import { classes, subscriptions, subscriptionsClasses } from '../../db/schema.ts'
import { readValidatedBodyWithZod, requireManagerOrAssistant } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, createSubscriptionSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  // Verify that all selected classIds exist in the active center and are not soft-deleted
  const validClasses = await db
    .select({
      id: classes.id,
      name: classes.name,
      color: classes.color,
    })
    .from(classes)
    .where(
      and(
        inArray(classes.id, body.classIds),
        eq(classes.centerId, auth.centerId),
        isNull(classes.deletedAt),
      ),
    )
    .orderBy(asc(classes.name))

  if (validClasses.length !== body.classIds.length) {
    throw createError({
      statusCode: 400,
      message: 'Uno o più corsi selezionati non sono validi o non appartengono alla sede attiva.',
    })
  }

  const subscriptionId = uuidv7()
  const newSubscription = {
    id: subscriptionId,
    centerId: auth.centerId,
    name: body.name.trim(),
    description: body.description ? body.description.trim() : null,
    entrances: body.entrances,
    durationDays: body.durationDays,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  const scRecords = body.classIds.map((classId) => ({
    id: uuidv7(),
    subscriptionId,
    classId,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }))

  await db.batch([
    db.insert(subscriptions).values(newSubscription),
    db.insert(subscriptionsClasses).values(scRecords),
  ])

  return {
    subscription: {
      ...newSubscription,
      classes: validClasses,
      classIds: validClasses.map((c) => c.id),
    },
  }
})

