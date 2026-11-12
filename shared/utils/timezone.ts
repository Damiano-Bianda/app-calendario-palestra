/**
 * DST-aware IANA timezone conversion and Italian (`it-IT`) display helpers.
 *
 * Rules from SPECIFICATION.md & GEMINI.md:
 * - Database stores all timestamps in UTC ISO 8601 (`CHAR(24)`, `YYYY-MM-DDTHH:mm:ss.sssZ`).
 * - Centers store geographical IANA timezone identifiers (e.g. `'Europe/Rome'`), never fixed numeric offsets.
 * - When creating/editing a schedule, local date & time are converted to UTC using the center's
 *   IANA timezone offset on the specific future date of the lesson (DST-aware).
 * - When displaying dates/times to users, always anchor to `center.timezone` via `Intl.DateTimeFormat('it-IT', { timeZone })`.
 */

const LOCAL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_TIME_REGEX = /^(\d{2}):(\d{2})(?::(\d{2}))?$/
const FIXED_OFFSET_TIMEZONE_REGEX = /^(?:UTC|GMT)?[+-]\d{1,2}(?::?\d{2})?$/i

export interface LocalDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** Day of week in the target timezone: 0 (Sunday) through 6 (Saturday) */
  weekday: number
  /** Local date formatted as `YYYY-MM-DD` */
  date: string
  /** Local time formatted as `HH:mm` */
  time: string
}

export interface RecurringScheduleDatesInput {
  /** Inclusive start date in center local time (`YYYY-MM-DD`) */
  rangeStartDate: string
  /** Inclusive end date in center local time (`YYYY-MM-DD`) */
  rangeEndDate: string
  /** Days of week to include (`0` = Sunday .. `6` = Saturday) */
  daysOfWeek: number[]
  /** Local start time (`HH:mm` or `HH:mm:ss`) */
  startTime: string
  /** Center IANA timezone (e.g. `'Europe/Rome'`) */
  timeZone: string
}

/**
 * Checks whether a string is a valid geographical IANA timezone identifier
 * (rejecting empty strings and fixed numeric offsets such as `'+01:00'` or `'GMT+1'`).
 */
export function isValidIanaTimezone(timeZone: string): boolean {
  if (typeof timeZone !== 'string') {
    return false
  }
  const trimmed = timeZone.trim()
  if (!trimmed || FIXED_OFFSET_TIMEZONE_REGEX.test(trimmed)) {
    return false
  }
  // Ensure it contains a region/location separator or is a recognized canonical IANA zone
  // while rejecting bare 'UTC'/'GMT' offsets if fixed offset syntax is used.
  try {
    new Intl.DateTimeFormat('it-IT', { timeZone: trimmed })
    return true
  } catch {
    return false
  }
}

function assertValidTimezone(timeZone: string): string {
  const trimmed = timeZone.trim()
  if (!isValidIanaTimezone(trimmed)) {
    throw new Error(`Fuso orario IANA non valido: "${timeZone}"`)
  }
  return trimmed
}

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_REGEX.exec(localDate.trim())
  if (!match) {
    throw new Error(`Formato data locale non valido: "${localDate}" (atteso YYYY-MM-DD)`)
  }
  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)

  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Data del calendario non esistente: "${localDate}"`)
  }

  return { year, month, day }
}

function parseLocalTime(localTime: string): { hour: number; minute: number; second: number } {
  const match = LOCAL_TIME_REGEX.exec(localTime.trim())
  if (!match) {
    throw new Error(`Formato ora locale non valido: "${localTime}" (atteso HH:mm o HH:mm:ss)`)
  }
  const hour = Number.parseInt(match[1]!, 10)
  const minute = Number.parseInt(match[2]!, 10)
  const second = match[3] ? Number.parseInt(match[3], 10) : 0

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new Error(`Orario locale fuori intervallo: "${localTime}"`)
  }

  return { hour, minute, second }
}

function extractPartsFromInstant(instantMs: number, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(new Date(instantMs))
  let year = 0
  let month = 0
  let day = 0
  let hour = 0
  let minute = 0
  let second = 0

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number.parseInt(part.value, 10)
        break
      case 'month':
        month = Number.parseInt(part.value, 10)
        break
      case 'day':
        day = Number.parseInt(part.value, 10)
        break
      case 'hour':
        // Guard against engines returning '24' for midnight
        hour = Number.parseInt(part.value, 10) % 24
        break
      case 'minute':
        minute = Number.parseInt(part.value, 10)
        break
      case 'second':
        second = Number.parseInt(part.value, 10)
        break
    }
  }

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  return { year, month, day, hour, minute, second, weekday, date, time }
}

/**
 * Computes the timezone offset in milliseconds (`localWallTimeAsUtcMs - instantMs`)
 * at a specific UTC instant for the given IANA timezone.
 */
export function getTimezoneOffsetMsAtInstant(instantMs: number, timeZone: string): number {
  const tz = assertValidTimezone(timeZone)
  const parts = extractPartsFromInstant(instantMs, tz)
  const msPart = ((instantMs % 1000) + 1000) % 1000
  const wallAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    msPart,
  )
  return wallAsUtcMs - instantMs
}

/**
 * Converts a UTC ISO 8601 string (`YYYY-MM-DDTHH:mm:ss.sssZ`) into local date/time components
 * anchored to the specified IANA timezone (`center.timezone`).
 */
export function utcIsoToLocalParts(utcIso: string, timeZone: string): LocalDateTimeParts {
  const tz = assertValidTimezone(timeZone)
  const instantMs = Date.parse(utcIso)
  if (Number.isNaN(instantMs)) {
    throw new Error(`Data UTC ISO 8601 non valida: "${utcIso}"`)
  }
  return extractPartsFromInstant(instantMs, tz)
}

/**
 * Converts a local date (`YYYY-MM-DD`) and local time (`HH:mm` or `HH:mm:ss`) in the center's
 * IANA timezone into a normalized 24-character UTC ISO 8601 string (`YYYY-MM-DDTHH:mm:ss.000Z`).
 *
 * Uses the timezone offset on the specific target date of the lesson (never today's offset),
 * ensuring accurate conversion across winter (standard) and summer (DST) periods.
 * Throws an error if the local time falls into a non-existent spring-forward DST gap.
 */
export function localDateTimeToUtcIso(
  localDate: string,
  localTime: string,
  timeZone: string,
): string {
  const tz = assertValidTimezone(timeZone)
  const { year, month, day } = parseLocalDate(localDate)
  const { hour, minute, second } = parseLocalTime(localTime)

  const targetWallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0)

  // Pass 1: estimate offset at targetWallAsUtcMs
  const offset1 = getTimezoneOffsetMsAtInstant(targetWallAsUtcMs, tz)
  const candidate1Ms = targetWallAsUtcMs - offset1

  // Pass 2: refine offset at candidate1Ms (handles DST transition boundary hours)
  const offset2 = getTimezoneOffsetMsAtInstant(candidate1Ms, tz)
  const candidate2Ms = targetWallAsUtcMs - offset2

  const matchesWallTime = (instantMs: number): boolean => {
    const p = extractPartsFromInstant(instantMs, tz)
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    )
  }

  if (matchesWallTime(candidate1Ms)) {
    return new Date(candidate1Ms).toISOString()
  }
  if (matchesWallTime(candidate2Ms)) {
    return new Date(candidate2Ms).toISOString()
  }

  throw new Error(
    `L'orario locale ${localDate} ${localTime} non esiste nel fuso orario ${tz} a causa del passaggio all'ora legale (DST).`,
  )
}

/**
 * Generates normalized UTC ISO 8601 `start_date` strings for recurring weekly lessons
 * between `rangeStartDate` and `rangeEndDate` (inclusive) on the selected `daysOfWeek`
 * at `startTime` in `center.timezone`.
 *
 * Each generated lesson date computes its own DST offset on that specific future date.
 */
export function generateRecurringScheduleStartDates(
  input: RecurringScheduleDatesInput,
): string[] {
  const tz = assertValidTimezone(input.timeZone)
  const start = parseLocalDate(input.rangeStartDate)
  const end = parseLocalDate(input.rangeEndDate)
  parseLocalTime(input.startTime)

  const startCursorMs = Date.UTC(start.year, start.month - 1, start.day)
  const endCursorMs = Date.UTC(end.year, end.month - 1, end.day)

  if (endCursorMs < startCursorMs) {
    throw new Error('La data di fine non può essere precedente alla data di inizio.')
  }

  const allowedDays = new Set(input.daysOfWeek)
  if (allowedDays.size === 0) {
    throw new Error('Selezionare almeno un giorno della settimana.')
  }

  const results: string[] = []
  const ONE_DAY_MS = 86_400_000

  for (let currentMs = startCursorMs; currentMs <= endCursorMs; currentMs += ONE_DAY_MS) {
    const cursorDate = new Date(currentMs)
    const weekday = cursorDate.getUTCDay()
    if (!allowedDays.has(weekday)) {
      continue
    }
    const y = cursorDate.getUTCFullYear()
    const m = cursorDate.getUTCMonth() + 1
    const d = cursorDate.getUTCDate()
    const localDateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    results.push(localDateTimeToUtcIso(localDateStr, input.startTime, tz))
  }

  return results
}

/**
 * Formats a UTC ISO 8601 date string in Italian (`it-IT`) anchored to `center.timezone`,
 * ignoring the client device's local timezone.
 *
 * Default format: `dd/mm/yyyy` (e.g. `'10/11/2026'`).
 */
export function formatCenterDate(
  utcIso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  },
): string {
  const tz = assertValidTimezone(timeZone)
  const instantMs = Date.parse(utcIso)
  if (Number.isNaN(instantMs)) {
    throw new Error(`Data UTC ISO 8601 non valida: "${utcIso}"`)
  }
  return new Intl.DateTimeFormat('it-IT', {
    ...options,
    timeZone: tz,
  }).format(new Date(instantMs))
}

/**
 * Formats a UTC ISO 8601 timestamp as a 24-hour time string (`HH:mm`) in Italian (`it-IT`)
 * anchored to `center.timezone`, ignoring the client device's local timezone.
 */
export function formatCenterTime(utcIso: string, timeZone: string): string {
  const parts = utcIsoToLocalParts(utcIso, timeZone)
  return parts.time
}

/**
 * Formats a UTC ISO 8601 timestamp as date and 24-hour time (`dd/mm/yyyy, HH:mm`)
 * in Italian (`it-IT`) anchored to `center.timezone`.
 */
export function formatCenterDateTime(utcIso: string, timeZone: string): string {
  const dateStr = formatCenterDate(utcIso, timeZone)
  const timeStr = formatCenterTime(utcIso, timeZone)
  return `${dateStr}, ${timeStr}`
}

/**
 * Formats a UTC ISO 8601 timestamp as a full Italian day header (e.g. `'martedì 10 novembre 2026'`)
 * anchored to `center.timezone`.
 */
export function formatCenterDayHeader(utcIso: string, timeZone: string): string {
  return formatCenterDate(utcIso, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Formats a lesson's start time and duration as a local time range (`HH:mm - HH:mm`)
 * anchored to `center.timezone`.
 */
export function formatCenterTimeRange(
  startUtcIso: string,
  durationMinutes: number,
  timeZone: string,
): string {
  const tz = assertValidTimezone(timeZone)
  const startMs = Date.parse(startUtcIso)
  if (Number.isNaN(startMs)) {
    throw new Error(`Data UTC ISO 8601 non valida: "${startUtcIso}"`)
  }
  const endMs = startMs + durationMinutes * 60_000
  const startTime = formatCenterTime(startUtcIso, tz)
  const endTime = formatCenterTime(new Date(endMs).toISOString(), tz)
  return `${startTime} - ${endTime}`
}

