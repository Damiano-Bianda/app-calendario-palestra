import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { uuidv7 } from 'uuidv7'
import { createUserSubscriptionSchema } from '../../../shared/schemas/subscriptions.ts'
import { isUserSubscriptionActive } from '../../../shared/utils/subscription-entrances.ts'
import { subscriptions, users, usersCenters, usersSubscriptions } from '../../db/schema.ts'
import { readValidatedBodyWithZod, requireManagerOrAssistant } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, createUserSubscriptionSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  // 1. Verify active user membership in the current center
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: usersCenters.name,
      surname: usersCenters.surname,
      phoneNumber: usersCenters.phoneNumber,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.userId, body.userId),
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

  // 2. Verify active subscription template in the current center
  const template = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, body.subscriptionId),
      eq(subscriptions.centerId, auth.centerId),
      isNull(subscriptions.deletedAt),
    ),
  })

  if (!template) {
    throw createError({
      statusCode: 404,
      message: 'Abbonamento non trovato nella sede attiva.',
    })
  }

  // 3. Calculate `end_date` and copy `entrances` from the template (SPECIFICATION.md line 499)
  const startMs = Date.parse(body.startDate)
  const endDate =
    template.durationDays === null
      ? null
      : new Date(startMs + template.durationDays * MS_PER_DAY).toISOString()

  const entrances = template.entrances

  const newRecord = {
    id: uuidv7(),
    subscriptionId: template.id,
    centerId: auth.centerId,
    userId: targetUser.id,
    startDate: body.startDate,
    endDate,
    entrances,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  await db.insert(usersSubscriptions).values(newRecord)

  const isActive = isUserSubscriptionActive(newRecord, entrances, now)

  return {
    userSubscription: {
      ...newRecord,
      usedEntrances: 0,
      remainingEntrances: entrances,
      isActive,
      subscription: {
        id: template.id,
        name: template.name,
        description: template.description,
        entrances: template.entrances,
        durationDays: template.durationDays,
      },
      user: targetUser,
    },
  }
})

