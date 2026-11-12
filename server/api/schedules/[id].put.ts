import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler, readBody } from 'h3'
import { updateScheduleSchema } from '../../../shared/schemas/schedules.ts'
import {
  EDITABLE_SCHEDULE_STATUSES,
  isScheduleCreationMarginValid,
  isScheduleTimelineOrderValid,
} from '../../../shared/utils/schedule-status.ts'
import { localDateTimeToUtcIso } from '../../../shared/utils/timezone.ts'
import { classes, schedules, users, usersCenters } from '../../db/schema.ts'
import { requireManagerOrAssistant, requireUuidParam } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import {
  attachComputedScheduleMetrics,
  enrichSchedulesForResponse,
} from '../../utils/domain-queries.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const scheduleId = requireUuidParam(event, 'id')
  const db = useDb(event)
  const now = new Date().toISOString()

  const existing = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), eq(schedules.centerId, auth.centerId)),
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Lezione non trovata.',
    })
  }

  const [currentWithMetrics] = await attachComputedScheduleMetrics(db, [existing], now)
  if (!currentWithMetrics || !EDITABLE_SCHEDULE_STATUSES.includes(currentWithMetrics.status)) {
    throw createError({
      statusCode: 409,
      message: `Impossibile modificare la lezione: la modifica è consentita solo in stato DRAFT o PUBLISHED (stato attuale: ${currentWithMetrics?.status ?? 'SCONOSCIUTO'}).`,
    })
  }

  const rawBody = (await readBody(event).catch(() => ({}))) as Record<string, unknown> | null
  const normalizedInput: Record<string, unknown> = { ...(rawBody ?? {}) }

  // Allow optional localDate + startTime conversion in center.timezone if startDate was not provided directly
  if (
    !normalizedInput.startDate &&
    typeof normalizedInput.localDate === 'string' &&
    typeof normalizedInput.startTime === 'string'
  ) {
    try {
      normalizedInput.startDate = localDateTimeToUtcIso(
        normalizedInput.localDate,
        normalizedInput.startTime,
        auth.timezone,
      )
    } catch (err) {
      throw createError({
        statusCode: 400,
        message: err instanceof Error ? err.message : 'Data o ora locale non valida.',
      })
    }
  }

  const parsed = updateScheduleSchema.safeParse(normalizedInput)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    throw createError({
      statusCode: 400,
      message: firstIssue?.message ?? 'Dati di modifica della lezione non validi.',
      data: {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    })
  }

  const body = parsed.data

  // Verify class exists in the active center
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

  // Verify instructor if provided
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

  // Enforce timeline ordering constraint (SPECIFICATION.md line 334 & SQLite CHECK constraint)
  if (
    !isScheduleTimelineOrderValid({
      startDate: body.startDate,
      durationMinutes: body.durationMinutes,
      publicationMinutesBefore: body.publicationMinutesBefore,
      registrationOpenMinutesBefore: body.registrationOpenMinutesBefore,
      registrationCloseMinutesBefore: body.registrationCloseMinutesBefore,
      createdAt: existing.createdAt,
    })
  ) {
    throw createError({
      statusCode: 400,
      message:
        "L'ordine temporale tra creazione, pubblicazione, apertura/chiusura iscrizioni e inizio lezione non è valido.",
    })
  }

  if (
    !isScheduleCreationMarginValid(body.startDate, body.registrationCloseMinutesBefore, now)
  ) {
    throw createError({
      statusCode: 400,
      message:
        'La chiusura delle iscrizioni della lezione deve avvenire almeno 5 minuti nel futuro rispetto ad ora.',
    })
  }

  const updatedRow = {
    ...existing,
    classId: body.classId,
    instructorId: body.instructorId,
    startDate: body.startDate,
    durationMinutes: body.durationMinutes,
    availableSpots: body.availableSpots,
    minimumSpots: body.minimumSpots,
    publicationMinutesBefore: body.publicationMinutesBefore,
    registrationOpenMinutesBefore: body.registrationOpenMinutesBefore,
    registrationCloseMinutesBefore: body.registrationCloseMinutesBefore,
    updatedBy: auth.userId,
    updatedAt: now,
  }

  await db
    .update(schedules)
    .set({
      classId: updatedRow.classId,
      instructorId: updatedRow.instructorId,
      startDate: updatedRow.startDate,
      durationMinutes: updatedRow.durationMinutes,
      availableSpots: updatedRow.availableSpots,
      minimumSpots: updatedRow.minimumSpots,
      publicationMinutesBefore: updatedRow.publicationMinutesBefore,
      registrationOpenMinutesBefore: updatedRow.registrationOpenMinutesBefore,
      registrationCloseMinutesBefore: updatedRow.registrationCloseMinutesBefore,
      updatedBy: updatedRow.updatedBy,
      updatedAt: updatedRow.updatedAt,
    })
    .where(eq(schedules.id, scheduleId))

  const [enriched] = await enrichSchedulesForResponse(db, [updatedRow], {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  return {
    schedule: enriched!,
  }
})

