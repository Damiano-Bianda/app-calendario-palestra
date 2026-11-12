import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { updateClassSchema } from '../../../shared/schemas/classes.ts'
import { classes, schedules, users } from '../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireManagerOrAssistant,
  requireUuidParam,
} from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { attachComputedScheduleMetrics } from '../../utils/domain-queries.ts'
import { sendClassUpdatedEmail } from '../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const classId = requireUuidParam(event, 'id')
  const body = await readValidatedBodyWithZod(event, updateClassSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  const existing = await db.query.classes.findFirst({
    where: and(
      eq(classes.id, classId),
      eq(classes.centerId, auth.centerId),
      isNull(classes.deletedAt),
    ),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Corso non trovato.',
    })
  }

  const nextName = body.name.trim()
  const nextDescription = body.description ? body.description.trim() : null
  const nameOrDescriptionChanged =
    existing.name !== nextName || (existing.description ?? null) !== nextDescription

  await db
    .update(classes)
    .set({
      name: nextName,
      description: nextDescription,
      color: body.color,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(eq(classes.id, classId))

  let notifiedCount = 0

  if (nameOrDescriptionChanged && body.notifyEnrolled) {
    const classSchedules = await db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.classId, classId),
          eq(schedules.centerId, auth.centerId),
          isNull(schedules.deletedAt),
        ),
      )

    const computedSchedules = await attachComputedScheduleMetrics(db, classSchedules, now)
    const enrollingOrUpcoming = computedSchedules.filter(
      (s) => s.status === 'ENROLLING' || s.status === 'UPCOMING',
    )

    const enrolledUserIds = new Set<string>()
    for (const sched of enrollingOrUpcoming) {
      for (const enrollment of sched.activeUserSchedules) {
        if (!enrollment.isQueued) {
          enrolledUserIds.add(enrollment.userId)
        }
      }
    }

    if (enrolledUserIds.size > 0) {
      const enrolledUsers = await db
        .select({ email: users.email })
        .from(users)
        .where(and(inArray(users.id, Array.from(enrolledUserIds)), isNull(users.deletedAt)))

      const recipientEmails = Array.from(new Set(enrolledUsers.map((u) => u.email)))
      if (recipientEmails.length > 0) {
        await sendClassUpdatedEmail(event, {
          to: recipientEmails,
          centerName: auth.centerName,
          previousName: existing.name,
          newName: nextName,
          newDescription: nextDescription,
          customMessage: body.notificationMessage ?? null,
        })
        notifiedCount = recipientEmails.length
      }
    }
  }

  return {
    class: {
      ...existing,
      name: nextName,
      description: nextDescription,
      color: body.color,
      updatedBy: auth.userId,
      updatedAt: now,
    },
    notifiedCount,
  }
})

