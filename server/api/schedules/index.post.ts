import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { uuidv7 } from 'uuidv7'
import {
  createRecurringSchedulesSchema,
  validateScheduleForCreation,
} from '../../../shared/schemas/schedules.ts'
import { generateRecurringScheduleStartDates } from '../../../shared/utils/timezone.ts'
import { classes, schedules, users, usersCenters } from '../../db/schema.ts'
import { readValidatedBodyWithZod, requireManagerOrAssistant } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { enrichSchedulesForResponse } from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, createRecurringSchedulesSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  // 1. Verify active course in the active center
  const targetClass = await db.query.classes.findFirst({
    where: and(
      eq(classes.id, body.classId),
      eq(classes.centerId, auth.centerId),
      isNull(classes.deletedAt),
    ),
  })

  if (!targetClass) {
    throw createError({
      statusCode: 400,
      message: 'Il corso selezionato non esiste o non appartiene alla sede attiva.',
    })
  }

  // 2. If instructorId is provided, verify active instructor in the active center
  if (body.instructorId) {
    const instructorRows = await db
      .select({ id: users.id })
      .from(usersCenters)
      .innerJoin(users, eq(usersCenters.userId, users.id))
      .where(
        and(
          eq(usersCenters.centerId, auth.centerId),
          eq(usersCenters.userId, body.instructorId),
          eq(usersCenters.isInstructor, true),
          isNull(usersCenters.deletedAt),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)

    if (instructorRows.length === 0) {
      throw createError({
        statusCode: 400,
        message: "L'istruttore selezionato non è valido o non è abilitato per questa sede.",
      })
    }
  }

  // 3. Generate DST-aware UTC ISO start dates in center.timezone
  let startDates: string[]
  try {
    startDates = generateRecurringScheduleStartDates({
      rangeStartDate: body.rangeStartDate,
      rangeEndDate: body.rangeEndDate,
      daysOfWeek: body.daysOfWeek,
      startTime: body.startTime,
      timeZone: auth.timezone,
    })
  } catch (err) {
    throw createError({
      statusCode: 400,
      message:
        err instanceof Error
          ? err.message
          : 'Errore nella generazione delle date per le lezioni ricorrenti.',
    })
  }

  if (startDates.length === 0) {
    throw createError({
      statusCode: 400,
      message:
        "Nessuna data corrispondente ai giorni della settimana selezionati nell'intervallo indicato.",
    })
  }

  // 4. Validate timeline ordering & 5-minute creation margin for every generated occurrence
  for (const startDate of startDates) {
    const validation = validateScheduleForCreation(
      {
        classId: body.classId,
        centerId: auth.centerId,
        instructorId: body.instructorId,
        startDate,
        durationMinutes: body.durationMinutes,
        minimumSpots: body.minimumSpots,
        availableSpots: body.availableSpots,
        publicationMinutesBefore: body.publicationMinutesBefore,
        registrationOpenMinutesBefore: body.registrationOpenMinutesBefore,
        registrationCloseMinutesBefore: body.registrationCloseMinutesBefore,
        createdAt: now,
      },
      now,
    )

    if (!validation.success) {
      const firstIssue = validation.error.issues[0]
      throw createError({
        statusCode: 400,
        message:
          firstIssue?.message ??
          'I parametri temporali della lezione non rispettano i vincoli richiesti.',
      })
    }
  }

  // 5. Build schedule rows and insert atomically via D1 batch
  const newScheduleRows = startDates.map((startDate) => ({
    id: uuidv7(),
    classId: body.classId,
    centerId: auth.centerId,
    instructorId: body.instructorId,
    startDate,
    durationMinutes: body.durationMinutes,
    availableSpots: body.availableSpots,
    minimumSpots: body.minimumSpots,
    publicationMinutesBefore: body.publicationMinutesBefore,
    registrationOpenMinutesBefore: body.registrationOpenMinutesBefore,
    registrationCloseMinutesBefore: body.registrationCloseMinutesBefore,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }))

  await db.batch([db.insert(schedules).values(newScheduleRows)])

  const enriched = await enrichSchedulesForResponse(db, newScheduleRows, {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  return {
    schedules: enriched,
    createdCount: enriched.length,
  }
})

