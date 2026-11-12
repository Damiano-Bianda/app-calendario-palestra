import type { ClassColor } from '../../shared/schemas/common'
import type { ScheduleStatus } from '../../shared/utils/schedule-status'
import { utcIsoToLocalParts } from '../../shared/utils/timezone'

export interface ClassColorStyle {
  value: ClassColor
  label: string
  swatchClass: string
  badgeClass: string
  calendarCardClass: string
}

export const CLASS_COLOR_STYLES: Record<ClassColor, ClassColorStyle> = {
  black: {
    value: 'black',
    label: 'Nero',
    swatchClass: 'bg-slate-900 border-slate-900',
    badgeClass: 'bg-slate-900 text-white border-slate-900',
    calendarCardClass: 'bg-slate-900 text-white border-slate-950 hover:bg-slate-800',
  },
  white: {
    value: 'white',
    label: 'Bianco',
    swatchClass: 'bg-white border-slate-300',
    badgeClass: 'bg-white text-slate-900 border-slate-300',
    calendarCardClass: 'bg-white text-slate-900 border-slate-300 hover:bg-slate-50 shadow-xs',
  },
  red: {
    value: 'red',
    label: 'Rosso',
    swatchClass: 'bg-red-600 border-red-600',
    badgeClass: 'bg-red-100 text-red-900 border-red-300',
    calendarCardClass: 'bg-red-600 text-white border-red-700 hover:bg-red-500',
  },
  blue: {
    value: 'blue',
    label: 'Blu',
    swatchClass: 'bg-blue-600 border-blue-600',
    badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
    calendarCardClass: 'bg-blue-600 text-white border-blue-700 hover:bg-blue-500',
  },
  green: {
    value: 'green',
    label: 'Verde',
    swatchClass: 'bg-emerald-600 border-emerald-600',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    calendarCardClass: 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-500',
  },
  yellow: {
    value: 'yellow',
    label: 'Giallo',
    swatchClass: 'bg-amber-400 border-amber-500',
    badgeClass: 'bg-amber-100 text-amber-950 border-amber-300',
    calendarCardClass: 'bg-amber-400 text-slate-950 border-amber-500 hover:bg-amber-300',
  },
  orange: {
    value: 'orange',
    label: 'Arancione',
    swatchClass: 'bg-orange-500 border-orange-600',
    badgeClass: 'bg-orange-100 text-orange-950 border-orange-300',
    calendarCardClass: 'bg-orange-500 text-white border-orange-600 hover:bg-orange-400',
  },
  purple: {
    value: 'purple',
    label: 'Viola',
    swatchClass: 'bg-purple-600 border-purple-600',
    badgeClass: 'bg-purple-100 text-purple-900 border-purple-300',
    calendarCardClass: 'bg-purple-600 text-white border-purple-700 hover:bg-purple-500',
  },
  pink: {
    value: 'pink',
    label: 'Rosa',
    swatchClass: 'bg-pink-500 border-pink-600',
    badgeClass: 'bg-pink-100 text-pink-900 border-pink-300',
    calendarCardClass: 'bg-pink-500 text-white border-pink-600 hover:bg-pink-400',
  },
  cyan: {
    value: 'cyan',
    label: 'Ciano',
    swatchClass: 'bg-cyan-600 border-cyan-600',
    badgeClass: 'bg-cyan-100 text-cyan-950 border-cyan-300',
    calendarCardClass: 'bg-cyan-600 text-white border-cyan-700 hover:bg-cyan-500',
  },
}

export function getClassColorStyle(color?: string | null): ClassColorStyle {
  if (color && color in CLASS_COLOR_STYLES) {
    return CLASS_COLOR_STYLES[color as ClassColor]
  }
  return CLASS_COLOR_STYLES.black
}

export interface ScheduleStatusStyle {
  status: ScheduleStatus
  label: string
  badgeClass: string
}

export const SCHEDULE_STATUS_STYLES: Record<ScheduleStatus, ScheduleStatusStyle> = {
  DRAFT: {
    status: 'DRAFT',
    label: 'Bozza',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  PUBLISHED: {
    status: 'PUBLISHED',
    label: 'Pubblicata',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-300',
  },
  ENROLLING: {
    status: 'ENROLLING',
    label: 'Iscrizioni aperte',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  UPCOMING: {
    status: 'UPCOMING',
    label: 'In partenza',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  },
  ACTIVE: {
    status: 'ACTIVE',
    label: 'In corso',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  COMPLETED: {
    status: 'COMPLETED',
    label: 'Terminata',
    badgeClass: 'bg-slate-200 text-slate-800 border-slate-300',
  },
  CANCELLED_LOW_ENROLLMENT: {
    status: 'CANCELLED_LOW_ENROLLMENT',
    label: 'Annullata (iscritti minimi non raggiunti)',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  CANCELLED_BY_PROVIDER: {
    status: 'CANCELLED_BY_PROVIDER',
    label: 'Annullata dal gerente',
    badgeClass: 'bg-red-100 text-red-800 border-red-300',
  },
}

export function getScheduleStatusStyle(status: ScheduleStatus): ScheduleStatusStyle {
  return SCHEDULE_STATUS_STYLES[status] ?? SCHEDULE_STATUS_STYLES.DRAFT
}

export const ITALIAN_DAYS_OF_WEEK: Array<{ value: number; label: string; short: string }> = [
  { value: 1, label: 'Lunedì', short: 'Lun' },
  { value: 2, label: 'Martedì', short: 'Mar' },
  { value: 3, label: 'Mercoledì', short: 'Mer' },
  { value: 4, label: 'Giovedì', short: 'Gio' },
  { value: 5, label: 'Venerdì', short: 'Ven' },
  { value: 6, label: 'Sabato', short: 'Sab' },
  { value: 0, label: 'Domenica', short: 'Dom' },
]

export function getTodayInCenterTimezone(timeZone: string): string {
  try {
    return utcIsoToLocalParts(new Date().toISOString(), timeZone).date
  } catch {
    return utcIsoToLocalParts(new Date().toISOString(), 'Europe/Rome').date
  }
}

export function minutesToHoursAndMinutes(totalMinutes: number | null | undefined): {
  hours: string
  minutes: string
} {
  if (totalMinutes === null || totalMinutes === undefined || Number.isNaN(totalMinutes)) {
    return { hours: '', minutes: '' }
  }
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return {
    hours: String(h),
    minutes: String(m),
  }
}

export function hoursAndMinutesToTotalMinutes(
  hoursRaw: string | number | null | undefined,
  minutesRaw: string | number | null | undefined,
): number | null {
  const hStr = String(hoursRaw ?? '').trim()
  const mStr = String(minutesRaw ?? '').trim()
  if (hStr === '' && mStr === '') {
    return null
  }
  const h = hStr === '' ? 0 : Number.parseInt(hStr, 10)
  const m = mStr === '' ? 0 : Number.parseInt(mStr, 10)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0) {
    return Number.NaN
  }
  const total = h * 60 + m
  return total === 0 ? null : total
}

export function formatMinutesOffsetLabel(minutes: number | null | undefined, fallback: string): string {
  if (minutes === null || minutes === undefined) {
    return fallback
  }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.length > 0 ? `${parts.join(' ')} prima` : fallback
}

export function extractApiErrorMessage(err: unknown, fallback = 'Si è verificato un errore.'): string {
  if (!err || typeof err !== 'object') {
    return fallback
  }
  const anyErr = err as {
    data?: { message?: string; statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  if (typeof anyErr.data?.message === 'string' && anyErr.data.message.trim()) {
    return anyErr.data.message
  }
  if (typeof anyErr.data?.statusMessage === 'string' && anyErr.data.statusMessage.trim()) {
    return anyErr.data.statusMessage
  }
  if (typeof anyErr.statusMessage === 'string' && anyErr.statusMessage.trim()) {
    return anyErr.statusMessage
  }
  if (typeof anyErr.message === 'string' && anyErr.message.trim()) {
    return anyErr.message
  }
  return fallback
}

