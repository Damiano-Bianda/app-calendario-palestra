import { describe, expect, it } from 'vitest'
import {
  formatCenterDate,
  formatCenterDateTime,
  formatCenterDayHeader,
  formatCenterTime,
  formatCenterTimeRange,
  generateRecurringScheduleStartDates,
  isValidIanaTimezone,
  localDateTimeToUtcIso,
  utcIsoToLocalParts,
} from '../shared/utils/timezone'

describe('DST-Aware Timezone Conversion & Display Helpers (shared/utils/timezone.ts)', () => {
  it('validates geographical IANA timezones and rejects fixed numeric offsets', () => {
    expect(isValidIanaTimezone('Europe/Rome')).toBe(true)
    expect(isValidIanaTimezone('America/New_York')).toBe(true)
    expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true)

    expect(isValidIanaTimezone('')).toBe(false)
    expect(isValidIanaTimezone('   ')).toBe(false)
    expect(isValidIanaTimezone('+01:00')).toBe(false)
    expect(isValidIanaTimezone('-05:00')).toBe(false)
    expect(isValidIanaTimezone('GMT+2')).toBe(false)
    expect(isValidIanaTimezone('UTC+1')).toBe(false)
    expect(isValidIanaTimezone('Invalid/Zone')).toBe(false)
  })

  it('converts local Europe/Rome time to UTC ISO 8601 using the target future lesson date offset (Winter CET vs Summer CEST)', () => {
    // Winter (CET = UTC+1): 2026-11-10 18:00 local -> 2026-11-10T17:00:00.000Z
    expect(localDateTimeToUtcIso('2026-11-10', '18:00', 'Europe/Rome')).toBe(
      '2026-11-10T17:00:00.000Z',
    )

    // Summer (CEST = UTC+2): 2026-07-10 18:00 local -> 2026-07-10T16:00:00.000Z
    expect(localDateTimeToUtcIso('2026-07-10', '18:00', 'Europe/Rome')).toBe(
      '2026-07-10T16:00:00.000Z',
    )
  })

  it('throws on nonexistent local times during spring-forward DST gap in Europe/Rome', () => {
    // On Sunday 2026-03-29 in Europe/Rome, clocks jump from 02:00 to 03:00
    expect(() => localDateTimeToUtcIso('2026-03-29', '02:30', 'Europe/Rome')).toThrow(
      /passaggio all'ora legale/i,
    )
  })

  it('generates recurring lesson UTC timestamps across DST boundaries while preserving local wall-clock time', () => {
    // In Europe/Rome, DST ends on Sunday 2026-10-25.
    // Let's generate Tuesday (2) and Friday (5) lessons at 18:00 from 2026-10-20 to 2026-10-30.
    const dates = generateRecurringScheduleStartDates({
      rangeStartDate: '2026-10-20',
      rangeEndDate: '2026-10-30',
      daysOfWeek: [2, 5], // Tuesday, Friday
      startTime: '18:00',
      timeZone: 'Europe/Rome',
    })

    expect(dates).toEqual([
      '2026-10-20T16:00:00.000Z', // Tue Oct 20 (CEST, UTC+2) -> 16:00Z
      '2026-10-23T16:00:00.000Z', // Fri Oct 23 (CEST, UTC+2) -> 16:00Z
      '2026-10-27T17:00:00.000Z', // Tue Oct 27 (CET, UTC+1)  -> 17:00Z
      '2026-10-30T17:00:00.000Z', // Fri Oct 30 (CET, UTC+1)  -> 17:00Z
    ])

    // Every single generated UTC timestamp must display as "18:00" in Europe/Rome
    for (const utcIso of dates) {
      expect(formatCenterTime(utcIso, 'Europe/Rome')).toBe('18:00')
    }
  })

  it('extracts local parts and formats dates/times in Italian anchored to center.timezone regardless of client timezone', () => {
    const utcIso = '2026-11-10T17:00:00.000Z'

    const romeParts = utcIsoToLocalParts(utcIso, 'Europe/Rome')
    expect(romeParts).toEqual({
      year: 2026,
      month: 11,
      day: 10,
      hour: 18,
      minute: 0,
      second: 0,
      weekday: 2, // Tuesday
      date: '2026-11-10',
      time: '18:00',
    })

    // Same UTC instant in Tokyo (UTC+9) is the next day at 02:00
    const tokyoParts = utcIsoToLocalParts(utcIso, 'Asia/Tokyo')
    expect(tokyoParts.date).toBe('2026-11-11')
    expect(tokyoParts.time).toBe('02:00')

    expect(formatCenterDate(utcIso, 'Europe/Rome')).toBe('10/11/2026')
    expect(formatCenterTime(utcIso, 'Europe/Rome')).toBe('18:00')
    expect(formatCenterDateTime(utcIso, 'Europe/Rome')).toBe('10/11/2026, 18:00')
    expect(formatCenterTimeRange(utcIso, 60, 'Europe/Rome')).toBe('18:00 - 19:00')
    expect(formatCenterDayHeader(utcIso, 'Europe/Rome').toLowerCase()).toContain('novembre 2026')
  })
})

