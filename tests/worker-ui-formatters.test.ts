import { describe, expect, it } from 'vitest'
import {
  CLASS_COLOR_STYLES,
  extractApiErrorMessage,
  formatMinutesOffsetLabel,
  getClassColorStyle,
  getScheduleStatusStyle,
  getTodayInCenterTimezone,
  hoursAndMinutesToTotalMinutes,
  ITALIAN_DAYS_OF_WEEK,
  minutesToHoursAndMinutes,
  SCHEDULE_STATUS_STYLES,
} from '../app/utils/ui-formatters.ts'
import { CLASS_COLORS } from '../shared/schemas/common.ts'
import { SCHEDULE_STATUSES } from '../shared/utils/schedule-status.ts'

describe('Worker UI Formatters & Helpers', () => {
  it('defines Italian styles and labels for all 10 class colors', () => {
    for (const color of CLASS_COLORS) {
      const style = getClassColorStyle(color)
      expect(style.value).toBe(color)
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.calendarCardClass.length).toBeGreaterThan(0)
    }
    expect(getClassColorStyle('unknown').value).toBe('black')
    expect(CLASS_COLOR_STYLES.black.label).toBe('Nero')
    expect(CLASS_COLOR_STYLES.cyan.label).toBe('Ciano')
  })

  it('defines Italian labels for all 8 schedule statuses', () => {
    for (const status of SCHEDULE_STATUSES) {
      const style = getScheduleStatusStyle(status)
      expect(style.status).toBe(status)
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.badgeClass.length).toBeGreaterThan(0)
    }
    expect(SCHEDULE_STATUS_STYLES.DRAFT.label).toBe('Bozza')
    expect(SCHEDULE_STATUS_STYLES.ENROLLING.label).toBe('Iscrizioni aperte')
  })

  it('orders Italian days of the week from Monday (1) to Sunday (0)', () => {
    expect(ITALIAN_DAYS_OF_WEEK.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(ITALIAN_DAYS_OF_WEEK[0]?.label).toBe('Lunedì')
    expect(ITALIAN_DAYS_OF_WEEK[6]?.label).toBe('Domenica')
  })

  it('converts total minutes to hours and minutes and back', () => {
    expect(minutesToHoursAndMinutes(null)).toEqual({ hours: '', minutes: '' })
    expect(minutesToHoursAndMinutes(90)).toEqual({ hours: '1', minutes: '30' })
    expect(minutesToHoursAndMinutes(45)).toEqual({ hours: '0', minutes: '45' })

    expect(hoursAndMinutesToTotalMinutes('', '')).toBeNull()
    expect(hoursAndMinutesToTotalMinutes('0', '0')).toBeNull()
    expect(hoursAndMinutesToTotalMinutes('1', '30')).toBe(90)
    expect(hoursAndMinutesToTotalMinutes('', '45')).toBe(45)
    expect(hoursAndMinutesToTotalMinutes('2', '')).toBe(120)
  })

  it('formats minutes offset labels in Italian', () => {
    expect(formatMinutesOffsetLabel(null, 'Subito')).toBe('Subito')
    expect(formatMinutesOffsetLabel(60, 'Subito')).toBe('1h prima')
    expect(formatMinutesOffsetLabel(90, 'Subito')).toBe('1h 30m prima')
    expect(formatMinutesOffsetLabel(15, 'Subito')).toBe('15m prima')
  })

  it('returns YYYY-MM-DD for getTodayInCenterTimezone', () => {
    const ymd = getTodayInCenterTimezone('Europe/Rome')
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('extracts API error messages cleanly', () => {
    expect(extractApiErrorMessage({ data: { message: 'Errore custom' } })).toBe('Errore custom')
    expect(extractApiErrorMessage({ statusMessage: 'Errore HTTP' })).toBe('Errore HTTP')
    expect(extractApiErrorMessage(null, 'Fallback')).toBe('Fallback')
  })
})

