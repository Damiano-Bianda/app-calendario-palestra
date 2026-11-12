import { z } from 'zod'
import { isValidIanaTimezone } from '../utils/timezone.ts'

export const CLASS_COLORS = [
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'cyan',
] as const

export type ClassColor = (typeof CLASS_COLORS)[number]

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UTC_ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCAL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_TIME_REGEX = /^(\d{2}):(\d{2})$/
const PHONE_E164_REGEX = /^\+?[0-9]{7,15}$/

/**
 * UUID (CHAR(36)) schema.
 */
export const uuidSchema = z
  .string({ message: 'Identificativo obbligatorio.' })
  .regex(UUID_REGEX, { message: 'Identificativo UUID non valido.' })

/**
 * Creates a non-empty string schema matching the SQLite `CHECK (LENGTH(TRIM(col)) > 0)` constraint.
 */
export function nonEmptyStringSchema(fieldLabel: string, maxLength = 255) {
  return z
    .string({ message: `${fieldLabel} è obbligatorio.` })
    .refine((val) => val.trim().length > 0, {
      message: `${fieldLabel} non può essere vuoto.`,
    })
    .refine((val) => val.length <= maxLength, {
      message: `${fieldLabel} non può superare ${maxLength} caratteri.`,
    })
}

/**
 * Creates a nullable/optional non-empty string schema matching
 * `CHECK (col IS NULL OR LENGTH(TRIM(col)) > 0)`.
 */
export function nullableNonEmptyStringSchema(fieldLabel: string, maxLength = 1000) {
  return z
    .string({ message: `${fieldLabel} deve essere una stringa.` })
    .refine((val) => val.trim().length > 0, {
      message: `${fieldLabel} non può essere una stringa vuota (usare null se assente).`,
    })
    .refine((val) => val.length <= maxLength, {
      message: `${fieldLabel} non può superare ${maxLength} caratteri.`,
    })
    .nullable()
    .optional()
}

/**
 * UTC ISO 8601 string schema (`CHAR(24)`, `YYYY-MM-DDTHH:mm:ss.sssZ`).
 */
export const utcIsoDateStringSchema = z
  .string({ message: 'Data obbligatoria.' })
  .regex(UTC_ISO_8601_REGEX, {
    message: 'La data deve essere in formato UTC ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ).',
  })
  .refine(
    (val) => {
      const parsed = Date.parse(val)
      return !Number.isNaN(parsed) && new Date(parsed).toISOString() === val
    },
    { message: 'Data UTC ISO 8601 non valida.' },
  )

/**
 * UTC ISO 8601 string schema with 5-minute step (`minutes % 5 === 0`, seconds = 0, ms = 0),
 * matching `schedules.start_date` in SPECIFICATION.md (line 309).
 */
export const utcIsoFiveMinStepSchema = utcIsoDateStringSchema.refine(
  (val) => {
    const d = new Date(val)
    return (
      d.getUTCMinutes() % 5 === 0 &&
      d.getUTCSeconds() === 0 &&
      d.getUTCMilliseconds() === 0
    )
  },
  {
    message: "L'orario di inizio deve avere incrementi di 5 minuti (es. 18:00, 18:05).",
  },
)

/**
 * Local calendar date schema (`YYYY-MM-DD`).
 */
export const localDateStringSchema = z
  .string({ message: 'Data locale obbligatoria.' })
  .regex(LOCAL_DATE_REGEX, { message: 'La data deve essere nel formato YYYY-MM-DD.' })
  .refine(
    (val) => {
      const match = LOCAL_DATE_REGEX.exec(val)
      if (!match) return false
      const y = Number.parseInt(match[1]!, 10)
      const m = Number.parseInt(match[2]!, 10)
      const d = Number.parseInt(match[3]!, 10)
      const dt = new Date(Date.UTC(y, m - 1, d))
      return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d
    },
    { message: 'Data del calendario non valida.' },
  )

/**
 * Local 24h time schema (`HH:mm`) with 5-minute step (`minutes % 5 === 0`).
 */
export const localTimeFiveMinStepSchema = z
  .string({ message: 'Orario di inizio obbligatorio.' })
  .regex(LOCAL_TIME_REGEX, { message: "L'orario deve essere nel formato HH:mm." })
  .refine(
    (val) => {
      const match = LOCAL_TIME_REGEX.exec(val)
      if (!match) return false
      const h = Number.parseInt(match[1]!, 10)
      const m = Number.parseInt(match[2]!, 10)
      return h >= 0 && h <= 23 && m >= 0 && m <= 59 && m % 5 === 0
    },
    { message: "L'orario deve essere valido e avere incrementi di 5 minuti." },
  )

/**
 * International E.164 phone number schema (`^\+?[0-9]{7,15}$`, SPECIFICATION.md line 286).
 */
export const phoneE164Schema = z
  .string({ message: 'Numero di telefono obbligatorio.' })
  .refine((val) => val.trim().length > 0, {
    message: 'Il numero di telefono non può essere vuoto.',
  })
  .regex(PHONE_E164_REGEX, {
    message:
      'Il numero di telefono deve rispettare il formato internazionale E.164 (da 7 a 15 cifre, con prefisso + opzionale).',
  })

/**
 * Email address schema (max 255 characters, non-empty).
 */
export const emailSchema = z
  .string({ message: 'Indirizzo email obbligatorio.' })
  .trim()
  .min(1, { message: "L'indirizzo email non può essere vuoto." })
  .max(255, { message: "L'indirizzo email non può superare 255 caratteri." })
  .email({ message: 'Indirizzo email non valido.' })

/**
 * Geographical IANA timezone schema (e.g. `'Europe/Rome'`).
 */
export const ianaTimezoneSchema = z
  .string({ message: 'Fuso orario obbligatorio.' })
  .refine((val) => isValidIanaTimezone(val), {
    message: 'Fuso orario IANA non valido (es. Europe/Rome). Non usare offset fissi.',
  })

/**
 * Class color schema (`classes.color`, default `'black'`).
 */
export const classColorSchema = z
  .enum(CLASS_COLORS, {
    message: 'Colore del corso non valido.',
  })
  .default('black')

/**
 * Center creation/update schema (`centers`).
 */
export const centerSchema = z.object({
  name: nonEmptyStringSchema('Il nome della sede', 255),
  timezone: ianaTimezoneSchema,
})

export type CenterInput = z.infer<typeof centerSchema>

