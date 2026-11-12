import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { scheduleEmailSchema } from '../../../../shared/schemas/schedules.ts'
import { classes, schedules, userSchedules, users, usersCenters } from '../../../db/schema.ts'
import {
  readValidatedBodyWithZod,
  requireUuidParam,
  requireWorker,
} from '../../../utils/auth.ts'
import { useDb } from '../../../utils/db.ts'
import { sendScheduleParticipantsEmail } from '../../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const scheduleId = requireUuidParam(event, 'id')
  const body = await readValidatedBodyWithZod(event, scheduleEmailSchema)
  const db = useDb(event)

  const scheduleRow = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), eq(schedules.centerId, auth.centerId)),
  })

  if (!scheduleRow) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  // SPECIFICATION.md line 473: Allowed for (Assistant) Manager or the Instructor assigned to this lesson
  if (!auth.isManager && !auth.isAssistantManager) {
    if (!auth.isInstructor || scheduleRow.instructorId !== auth.userId) {
      throw createError({
        statusCode: 403,
        message:
          'Permessi insufficienti: un istruttore può contattare esclusivamente gli iscritti alle proprie lezioni.',
      })
    }
  }

  const enrolledRows = await db
    .select({
      email: users.email,
    })
    .from(userSchedules)
    .innerJoin(users, eq(userSchedules.userId, users.id))
    .innerJoin(
      usersCenters,
      and(
        eq(usersCenters.userId, users.id),
        eq(usersCenters.centerId, userSchedules.centerId),
      ),
    )
    .where(
      and(
        eq(userSchedules.scheduleId, scheduleId),
        eq(userSchedules.centerId, auth.centerId),
        eq(userSchedules.isQueued, false),
        isNull(userSchedules.deletedAt),
        isNull(users.deletedAt),
        isNull(usersCenters.deletedAt),
      ),
    )

  const recipientEmails = Array.from(new Set(enrolledRows.map((r) => r.email)))

  if (recipientEmails.length > 0) {
    const course = await db.query.classes.findFirst({
      where: eq(classes.id, scheduleRow.classId),
    })

    await sendScheduleParticipantsEmail(event, {
      to: recipientEmails,
      centerName: auth.centerName,
      timezone: auth.timezone,
      senderName: `${auth.name} ${auth.surname}`,
      className: course?.name ?? 'Corso',
      startDate: scheduleRow.startDate,
      durationMinutes: scheduleRow.durationMinutes,
      message: body.message,
    })
  }

  return {
    success: true,
    sentCount: recipientEmails.length,
  }
})

