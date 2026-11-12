import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { createError, defineEventHandler, getQuery } from 'h3'
import { SCHEDULE_STATUSES, type ScheduleStatus } from '../../../shared/utils/schedule-status.ts'
import { localDateTimeToUtcIso, utcIsoToLocalParts } from '../../../shared/utils/timezone.ts'
import { schedules } from '../../db/schema.ts'
import { requireAuth } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { enrichSchedulesForResponse } from '../../utils/domain-queries.ts'

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function localStartOfDayUtcIso(localDate: string, timeZone: string): string {
  return localDateTimeToUtcIso(localDate, '00:00:00', timeZone)
}

function localEndOfDayUtcIso(localDate: string, timeZone: string): string {
  const endSecIso = localDateTimeToUtcIso(localDate, '23:59:59', timeZone)
  return endSecIso.replace(/\.000Z$/, '.999Z')
}

function computeDateRangeFromView(
  dateParam: string,
  view: 'day' | 'week' | 'month',
  timeZone: string,
): { fromIso: string; toIso: string } {
  let localDateStr = dateParam.trim()
  if (!LOCAL_DATE_PATTERN.test(localDateStr)) {
    const parsedMs = Date.parse(localDateStr)
    if (Number.isNaN(parsedMs)) {
      throw createError({
        statusCode: 400,
        message: 'Parametro data non valido.',
      })
    }
    localDateStr = utcIsoToLocalParts(new Date(parsedMs).toISOString(), timeZone).date
  }

  const match = LOCAL_DATE_PATTERN.exec(localDateStr)
  if (!match) {
    throw createError({
      statusCode: 400,
      message: 'Formato data non valido (atteso YYYY-MM-DD).',
    })
  }

  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)

  try {
    if (view === 'day') {
      return {
        fromIso: localStartOfDayUtcIso(localDateStr, timeZone),
        toIso: localEndOfDayUtcIso(localDateStr, timeZone),
      }
    }

    if (view === 'week') {
      // Italian week starts on Monday (1) and ends on Sunday (0)
      const anchorUtc = new Date(Date.UTC(year, month - 1, day))
      const dow = anchorUtc.getUTCDay()
      const diffToMonday = dow === 0 ? -6 : 1 - dow
      const mondayUtc = new Date(anchorUtc.getTime() + diffToMonday * 86_400_000)
      const sundayUtc = new Date(mondayUtc.getTime() + 6 * 86_400_000)

      return {
        fromIso: localStartOfDayUtcIso(formatUtcDate(mondayUtc), timeZone),
        toIso: localEndOfDayUtcIso(formatUtcDate(sundayUtc), timeZone),
      }
    }

    // view === 'month'
    const firstDayStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
    const lastDayUtc = new Date(Date.UTC(year, month, 0))
    const lastDayStr = formatUtcDate(lastDayUtc)

    return {
      fromIso: localStartOfDayUtcIso(firstDayStr, timeZone),
      toIso: localEndOfDayUtcIso(lastDayStr, timeZone),
    }
  } catch (err) {
    throw createError({
      statusCode: 400,
      message: err instanceof Error ? err.message : 'Intervallo di date non valido.',
    })
  }
}

function normalizeBoundaryParam(
  raw: string,
  boundary: 'start' | 'end',
  timeZone: string,
): string {
  const trimmed = raw.trim()
  if (LOCAL_DATE_PATTERN.test(trimmed)) {
    try {
      return boundary === 'start'
        ? localStartOfDayUtcIso(trimmed, timeZone)
        : localEndOfDayUtcIso(trimmed, timeZone)
    } catch (err) {
      throw createError({
        statusCode: 400,
        message: err instanceof Error ? err.message : 'Data limite non valida.',
      })
    }
  }

  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) {
    throw createError({
      statusCode: 400,
      message: `Parametro data "${trimmed}" non valido.`,
    })
  }
  return new Date(ms).toISOString()
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = useDb(event)
  const query = getQuery(event)
  const now = new Date().toISOString()

  const rawFrom =
    typeof query.from === 'string' && query.from.trim().length > 0
      ? query.from
      : typeof query.startDate === 'string' && query.startDate.trim().length > 0
        ? query.startDate
        : undefined

  const rawTo =
    typeof query.to === 'string' && query.to.trim().length > 0
      ? query.to
      : typeof query.endDate === 'string' && query.endDate.trim().length > 0
        ? query.endDate
        : undefined

  const rawDate =
    typeof query.date === 'string' && query.date.trim().length > 0 ? query.date : undefined

  const rawView =
    query.view === 'week' || query.view === 'month' || query.view === 'day' ? query.view : 'day'

  let fromIso: string | undefined
  let toIso: string | undefined

  if (rawFrom || rawTo) {
    if (rawFrom) {
      fromIso = normalizeBoundaryParam(rawFrom, 'start', auth.timezone)
    }
    if (rawTo) {
      toIso = normalizeBoundaryParam(rawTo, 'end', auth.timezone)
    }
  } else if (rawDate) {
    const computed = computeDateRangeFromView(rawDate, rawView, auth.timezone)
    fromIso = computed.fromIso
    toIso = computed.toIso
  }

  const conditions = [eq(schedules.centerId, auth.centerId)]

  if (fromIso) {
    conditions.push(gte(schedules.startDate, fromIso))
  }
  if (toIso) {
    conditions.push(lte(schedules.startDate, toIso))
  }
  if (typeof query.classId === 'string' && query.classId.trim().length > 0) {
    conditions.push(eq(schedules.classId, query.classId.trim()))
  }
  if (typeof query.instructorId === 'string' && query.instructorId.trim().length > 0) {
    conditions.push(eq(schedules.instructorId, query.instructorId.trim()))
  }

  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc'

  const rawRows = await db
    .select()
    .from(schedules)
    .where(and(...conditions))
    .orderBy(
      sortOrder === 'desc' ? desc(schedules.startDate) : asc(schedules.startDate),
      asc(schedules.createdAt),
    )

  let enriched = await enrichSchedulesForResponse(db, rawRows, {
    centerId: auth.centerId,
    currentUserId: auth.userId,
    now,
  })

  // Customers (or workers explicitly viewing in customer mode) never see DRAFT schedules (SPECIFICATION.md line 466)
  const isCustomerView = !auth.isWorker || query.mode === 'customer'
  if (isCustomerView) {
    enriched = enriched.filter((s) => s.status !== 'DRAFT')
  }

  if (query.includeCancelled === 'false') {
    enriched = enriched.filter(
      (s) => s.status !== 'CANCELLED_BY_PROVIDER' && s.status !== 'CANCELLED_LOW_ENROLLMENT',
    )
  }

  if (typeof query.status === 'string' && query.status.trim().length > 0) {
    const statusFilter = query.status.trim() as ScheduleStatus
    if (SCHEDULE_STATUSES.includes(statusFilter)) {
      enriched = enriched.filter((s) => s.status === statusFilter)
    }
  }

  return {
    schedules: enriched,
  }
})

