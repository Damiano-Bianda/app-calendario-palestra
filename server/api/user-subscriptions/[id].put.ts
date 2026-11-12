import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import {
  updateUserSubscriptionSchema,
  validateUserSubscriptionModification,
} from '../../../shared/schemas/subscriptions.ts'
import { isUserSubscriptionActive } from '../../../shared/utils/subscription-entrances.ts'
import { usersSubscriptions } from '../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedUserSubscriptionMetrics } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const userSubId = requireUuidParam(event, 'id')
  const body = await readValidatedBodyWithZod(event, updateUserSubscriptionSchema)
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

  const [computed] = await attachComputedUserSubscriptionMetrics(db, [existing], now)
  if (!computed) {
    throw createError({
      statusCode: 404,
      message: 'Sottoscrizione non trovata.',
    })
  }

  // Enforce business modification guards (SPECIFICATION.md lines 187-189, 500):
  // 1) newEndDate > startDate
  // 2) newEndDate cannot precede any lesson already booked/queued with this subscription
  // 3) newEntrances cannot be less than usedEntrances
  const validation = validateUserSubscriptionModification({
    startDate: existing.startDate,
    newEndDate: body.endDate,
    newEntrances: body.entrances,
    usedEntrances: computed.usedEntrances,
    bookedScheduleStartDates: computed.bookedScheduleStartDates,
  })

  if (!validation.valid) {
    const firstError = validation.errors[0] ?? 'Modifica della sottoscrizione non valida.'
    const isStartEndOrderError = firstError.includes('successiva alla data di inizio')
    throw createError({
      statusCode: isStartEndOrderError ? 400 : 409,
      message: firstError,
    })
  }

  await db
    .update(usersSubscriptions)
    .set({
      endDate: body.endDate,
      entrances: body.entrances,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(eq(usersSubscriptions.id, userSubId))

  const updatedRecord = {
    ...existing,
    endDate: body.endDate,
    entrances: body.entrances,
    updatedBy: auth.userId,
    updatedAt: now,
  }

  const remainingEntrances =
    body.entrances === null ? null : body.entrances - computed.usedEntrances
  const isActive = isUserSubscriptionActive(updatedRecord, remainingEntrances, now)

  return {
    userSubscription: {
      ...updatedRecord,
      usedEntrances: computed.usedEntrances,
      remainingEntrances,
      isActive,
    },
  }
})

