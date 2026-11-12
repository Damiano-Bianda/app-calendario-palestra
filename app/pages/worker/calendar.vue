<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EnrichedScheduleResponse } from '../../../server/utils/domain-queries'
import {
  formatCenterDate,
  formatCenterDayHeader,
  formatCenterTime,
  formatCenterTimeRange,
  localDateTimeToUtcIso,
  utcIsoToLocalParts,
} from '../../../shared/utils/timezone'
import {
  getClassColorStyle,
  getScheduleStatusStyle,
  getTodayInCenterTimezone,
  ITALIAN_DAYS_OF_WEEK,
} from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite, centerTimezone } = useAuth()

// Desktop view mode: 'week' (default per SPECIFICATION.md line 394) or 'month'
const desktopView = ref<'week' | 'month'>('week')

// Anchor local date (YYYY-MM-DD in center.timezone), initialized to today in center.timezone
const selectedDate = ref<string>(getTodayInCenterTimezone(centerTimezone.value))

watch(centerTimezone, (newTz) => {
  selectedDate.value = getTodayInCenterTimezone(newTz)
})

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const parts = ymd.split('-').map((n) => Number.parseInt(n, 10))
  return {
    year: parts[0] || 2026,
    month: parts[1] || 1,
    day: parts[2] || 1,
  }
}

function formatYmdFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const { year, month, day } = parseYmd(ymd)
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays))
  return formatYmdFromUtcDate(dt)
}

function addMonthsToYmd(ymd: string, deltaMonths: number): string {
  const { year, month, day } = parseYmd(ymd)
  const targetFirst = new Date(Date.UTC(year, month - 1 + deltaMonths, 1))
  const targetYear = targetFirst.getUTCFullYear()
  const targetMonth = targetFirst.getUTCMonth() + 1
  const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const clampedDay = Math.min(day, maxDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

function getMondayOfWeek(ymd: string): string {
  const { year, month, day } = parseYmd(ymd)
  const dt = new Date(Date.UTC(year, month - 1, day))
  const dow = dt.getUTCDay() // 0 = Sun .. 6 = Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  return addDaysToYmd(ymd, diffToMonday)
}

// Selected month/year value (`YYYY-MM`) for the monthly selector
const selectedYearMonth = computed({
  get: () => selectedDate.value.slice(0, 7),
  set: (val: string) => {
    if (/^\d{4}-\d{2}$/.test(val)) {
      selectedDate.value = `${val}-01`
    }
  },
})

// Compute the 7 days (Monday..Sunday) of the selected week
const weekDays = computed(() => {
  const monday = getMondayOfWeek(selectedDate.value)
  const todayYmd = getTodayInCenterTimezone(centerTimezone.value)
  return Array.from({ length: 7 }, (_, i) => {
    const dateStr = addDaysToYmd(monday, i)
    const { day, month } = parseYmd(dateStr)
    const dayMeta = ITALIAN_DAYS_OF_WEEK[i]!
    return {
      date: dateStr,
      dayNumber: day,
      monthNumber: month,
      shortName: dayMeta.short,
      fullName: dayMeta.label,
      isToday: dateStr === todayYmd,
    }
  })
})

// Compute the full calendar grid (Monday..Sunday rows) for the selected month
const monthGridCells = computed(() => {
  const { year, month } = parseYmd(selectedDate.value)
  const firstDayYmd = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDayYmd = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`

  const gridStartMonday = getMondayOfWeek(firstDayYmd)
  const lastDayMonday = getMondayOfWeek(lastDayYmd)
  const gridEndSunday = addDaysToYmd(lastDayMonday, 6)

  const todayYmd = getTodayInCenterTimezone(centerTimezone.value)
  const cells: Array<{
    date: string
    dayNumber: number
    inCurrentMonth: boolean
    isToday: boolean
  }> = []

  let cursor = gridStartMonday
  while (cursor <= gridEndSunday) {
    const parsed = parseYmd(cursor)
    cells.push({
      date: cursor,
      dayNumber: parsed.day,
      inCurrentMonth: parsed.month === month && parsed.year === year,
      isToday: cursor === todayYmd,
    })
    cursor = addDaysToYmd(cursor, 1)
  }
  return cells
})

// Fetch bounding date range covering both the month grid and the current week
const queryRange = computed(() => {
  const cells = monthGridCells.value
  const week = weekDays.value
  const firstMonthCell = cells[0]?.date ?? selectedDate.value
  const lastMonthCell = cells[cells.length - 1]?.date ?? selectedDate.value
  const firstWeekCell = week[0]?.date ?? selectedDate.value
  const lastWeekCell = week[week.length - 1]?.date ?? selectedDate.value

  const from = firstMonthCell < firstWeekCell ? firstMonthCell : firstWeekCell
  const to = lastMonthCell > lastWeekCell ? lastMonthCell : lastWeekCell
  return { from, to }
})

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending } = await useAsyncData(
  'worker-calendar-schedules',
  () =>
    $fetch<{ schedules: EnrichedScheduleResponse[] }>('/api/schedules', {
      headers,
      query: {
        from: queryRange.value.from,
        to: queryRange.value.to,
      },
    }),
  {
    watch: [queryRange],
  },
)

interface CalendarScheduleItem extends EnrichedScheduleResponse {
  localDate: string
  localTime: string
  localHour: number
  localMinute: number
}

const localizedSchedules = computed<CalendarScheduleItem[]>(() => {
  const list = data.value?.schedules ?? []
  const tz = centerTimezone.value
  return list.map((s) => {
    const parts = utcIsoToLocalParts(s.startDate, tz)
    return {
      ...s,
      localDate: parts.date,
      localTime: parts.time,
      localHour: parts.hour,
      localMinute: parts.minute,
    }
  })
})

const schedulesByDate = computed(() => {
  const map = new Map<string, CalendarScheduleItem[]>()
  for (const item of localizedSchedules.value) {
    const list = map.get(item.localDate)
    if (list) {
      list.push(item)
    } else {
      map.set(item.localDate, [item])
    }
  }
  return map
})

// Hourly slots for Weekly (desktop) and Daily (mobile) grids: default 06:00..22:00, expanding if schedules exist earlier/later
const displayHours = computed(() => {
  let minHour = 7
  let maxHour = 21
  for (const s of localizedSchedules.value) {
    if (s.localHour < minHour) minHour = s.localHour
    if (s.localHour > maxHour) maxHour = s.localHour
  }
  const hours: number[] = []
  for (let h = minHour; h <= maxHour; h++) {
    hours.push(h)
  }
  return hours
})

function getSchedulesForDateAndHour(dateStr: string, hour: number): CalendarScheduleItem[] {
  const dayList = schedulesByDate.value.get(dateStr) ?? []
  return dayList.filter((s) => s.localHour === hour)
}

function getSchedulesForDate(dateStr: string): CalendarScheduleItem[] {
  return schedulesByDate.value.get(dateStr) ?? []
}

// Header labels anchored to center.timezone
const desktopPeriodLabel = computed(() => {
  const tz = centerTimezone.value
  if (desktopView.value === 'month') {
    const { year, month } = parseYmd(selectedDate.value)
    const midMonthIso = localDateTimeToUtcIso(
      `${year}-${String(month).padStart(2, '0')}-15`,
      '12:00',
      tz,
    )
    return formatCenterDate(midMonthIso, tz, {
      month: 'long',
      year: 'numeric',
    })
  }
  const firstDay = weekDays.value[0]!.date
  const lastDay = weekDays.value[6]!.date
  const startIso = localDateTimeToUtcIso(firstDay, '12:00', tz)
  const endIso = localDateTimeToUtcIso(lastDay, '12:00', tz)
  return `${formatCenterDate(startIso, tz, { day: '2-digit', month: 'short' })} – ${formatCenterDate(endIso, tz, { day: '2-digit', month: 'short', year: 'numeric' })}`
})

const mobileDayLabel = computed(() => {
  const tz = centerTimezone.value
  const iso = localDateTimeToUtcIso(selectedDate.value, '12:00', tz)
  return formatCenterDayHeader(iso, tz)
})

function prevDesktopPeriod() {
  if (desktopView.value === 'week') {
    selectedDate.value = addDaysToYmd(selectedDate.value, -7)
  } else {
    selectedDate.value = addMonthsToYmd(selectedDate.value, -1)
  }
}

function nextDesktopPeriod() {
  if (desktopView.value === 'week') {
    selectedDate.value = addDaysToYmd(selectedDate.value, 7)
  } else {
    selectedDate.value = addMonthsToYmd(selectedDate.value, 1)
  }
}

function prevMobileDay() {
  selectedDate.value = addDaysToYmd(selectedDate.value, -1)
}

function nextMobileDay() {
  selectedDate.value = addDaysToYmd(selectedDate.value, 1)
}

function goToToday() {
  selectedDate.value = getTodayInCenterTimezone(centerTimezone.value)
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

async function handleEmptySlotClick(dateStr: string, hour = 9) {
  // SPECIFICATION.md line 394: "Interazioni (solo per gerente e vice gerente): click su uno slot vuoto per creare una lezione in quella data/ora"
  if (!canWrite.value) return
  const timeStr = `${String(hour).padStart(2, '0')}:00`
  await navigateTo({
    path: '/worker/schedules/new',
    query: {
      date: dateStr,
      time: timeStr,
    },
  })
}

async function handleScheduleClick(scheduleId: string) {
  await navigateTo(`/worker/schedules/${scheduleId}`)
}
</script>

<template>
  <div class="space-y-4">
    <!-- =================================================================== -->
    <!-- DESKTOP CALENDAR (Weekly / Monthly grid)                            -->
    <!-- SPECIFICATION.md line 394                                           -->
    <!-- =================================================================== -->
    <div class="hidden md:flex md:flex-col md:space-y-4">
      <!-- Desktop Top Bar -->
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <!-- View Toggle: Settimanale / Mensile -->
        <div class="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            data-testid="view-toggle-week"
            class="rounded-md px-3.5 py-1.5 text-xs font-semibold transition"
            :class="
              desktopView === 'week'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            "
            @click="desktopView = 'week'"
          >
            Settimanale
          </button>
          <button
            type="button"
            data-testid="view-toggle-month"
            class="rounded-md px-3.5 py-1.5 text-xs font-semibold transition"
            :class="
              desktopView === 'month'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            "
            @click="desktopView = 'month'"
          >
            Mensile
          </button>
        </div>

        <!-- Date selector & < > navigation arrows -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-testid="desktop-prev-btn"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            title="Periodo precedente"
            @click="prevDesktopPeriod"
          >
            &lt;
          </button>

          <span class="min-w-48 text-center text-sm font-bold capitalize text-slate-900">
            {{ desktopPeriodLabel }}
          </span>

          <button
            type="button"
            data-testid="desktop-next-btn"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            title="Periodo successivo"
            @click="nextDesktopPeriod"
          >
            &gt;
          </button>

          <!-- Month/Year picker for Monthly view, Date picker for Weekly view -->
          <input
            v-if="desktopView === 'month'"
            v-model="selectedYearMonth"
            type="month"
            aria-label="Seleziona mese e anno"
            class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
          />
          <input
            v-else
            v-model="selectedDate"
            type="date"
            aria-label="Seleziona data"
            class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
          />

          <button
            type="button"
            class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            @click="goToToday"
          >
            Oggi
          </button>
        </div>

        <!-- "+ Crea lezione" button (hidden for read-only instructors) -->
        <div>
          <NuxtLink
            v-if="canWrite"
            :to="{ path: '/worker/schedules/new', query: { date: selectedDate } }"
            data-testid="desktop-create-schedule-btn"
            class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
          >
            + Crea lezione
          </NuxtLink>
        </div>
      </div>

      <!-- Desktop Weekly Grid -->
      <div
        v-if="desktopView === 'week'"
        class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
      >
        <div class="grid grid-cols-8 border-b border-slate-200 bg-slate-50">
          <div class="border-r border-slate-200 p-3 text-center text-xs font-semibold text-slate-500">
            Ora ({{ centerTimezone }})
          </div>
          <div
            v-for="day in weekDays"
            :key="day.date"
            class="border-r border-slate-200 p-2.5 text-center last:border-r-0"
            :class="day.isToday ? 'bg-indigo-50/70' : ''"
          >
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {{ day.shortName }}
            </div>
            <div
              class="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
              :class="day.isToday ? 'bg-indigo-600 text-white' : 'text-slate-900'"
            >
              {{ day.dayNumber }}
            </div>
          </div>
        </div>

        <div class="divide-y divide-slate-200">
          <div
            v-for="hour in displayHours"
            :key="hour"
            class="grid grid-cols-8 min-h-16"
          >
            <!-- Hour Label -->
            <div class="flex items-start justify-center border-r border-slate-200 bg-slate-50/60 p-2 text-xs font-medium text-slate-500">
              {{ formatHourLabel(hour) }}
            </div>

            <!-- 7 Day Slots -->
            <div
              v-for="day in weekDays"
              :key="`${day.date}-${hour}`"
              class="group relative border-r border-slate-100 p-1 transition last:border-r-0"
              :class="[
                day.isToday ? 'bg-indigo-50/20' : '',
                canWrite ? 'cursor-pointer hover:bg-slate-50' : '',
              ]"
              @click.self="handleEmptySlotClick(day.date, hour)"
            >
              <div class="space-y-1">
                <button
                  v-for="sched in getSchedulesForDateAndHour(day.date, hour)"
                  :key="sched.id"
                  type="button"
                  class="block w-full rounded-md border p-1.5 text-left text-xs transition"
                  :class="[
                    getClassColorStyle(sched.class?.color).calendarCardClass,
                    sched.status === 'CANCELLED_BY_PROVIDER' || sched.status === 'CANCELLED_LOW_ENROLLMENT'
                      ? 'opacity-50 line-through'
                      : '',
                  ]"
                  @click.stop="handleScheduleClick(sched.id)"
                >
                  <div class="flex items-center justify-between gap-1 font-bold">
                    <span class="truncate">{{ sched.class?.name ?? 'Corso' }}</span>
                    <span class="shrink-0 text-[10px] opacity-90">
                      {{ formatCenterTime(sched.startDate, centerTimezone) }}
                    </span>
                  </div>
                  <div class="mt-0.5 flex items-center justify-between text-[10px] opacity-90">
                    <span class="truncate">
                      {{ sched.instructor ? `${sched.instructor.name} ${sched.instructor.surname}` : 'Senza istruttore' }}
                    </span>
                    <span class="shrink-0">
                      {{ sched.enrolledCount }}/{{ sched.availableSpots ?? '∞' }}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Desktop Monthly Grid -->
      <div
        v-else
        class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
      >
        <div class="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
          <div
            v-for="d in ITALIAN_DAYS_OF_WEEK"
            :key="d.value"
            class="border-r border-slate-200 py-2.5 last:border-r-0"
          >
            {{ d.label }}
          </div>
        </div>

        <div class="grid grid-cols-7 divide-x divide-y divide-slate-200">
          <div
            v-for="cell in monthGridCells"
            :key="cell.date"
            class="min-h-32 p-2 transition"
            :class="[
              cell.inCurrentMonth ? 'bg-white' : 'bg-slate-50/70 text-slate-400',
              cell.isToday ? 'ring-2 ring-inset ring-indigo-500/40' : '',
              canWrite ? 'cursor-pointer hover:bg-slate-50/90' : '',
            ]"
            @click.self="handleEmptySlotClick(cell.date, 9)"
          >
            <div
              class="mb-1.5 flex items-center justify-between"
              @click.self="handleEmptySlotClick(cell.date, 9)"
            >
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                :class="
                  cell.isToday
                    ? 'bg-indigo-600 text-white'
                    : cell.inCurrentMonth
                      ? 'text-slate-800'
                      : 'text-slate-400'
                "
              >
                {{ cell.dayNumber }}
              </span>
              <span
                v-if="canWrite"
                class="text-[10px] font-medium text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-indigo-600"
                @click.stop="handleEmptySlotClick(cell.date, 9)"
              >
                +
              </span>
            </div>

            <div class="space-y-1">
              <button
                v-for="sched in getSchedulesForDate(cell.date)"
                :key="sched.id"
                type="button"
                class="block w-full truncate rounded border px-1.5 py-1 text-left text-[11px] font-medium transition"
                :class="[
                  getClassColorStyle(sched.class?.color).calendarCardClass,
                  sched.status === 'CANCELLED_BY_PROVIDER' || sched.status === 'CANCELLED_LOW_ENROLLMENT'
                    ? 'opacity-50 line-through'
                    : '',
                ]"
                @click.stop="handleScheduleClick(sched.id)"
              >
                <span class="font-bold">{{ formatCenterTime(sched.startDate, centerTimezone) }}</span>
                · {{ sched.class?.name ?? 'Corso' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- =================================================================== -->
    <!-- MOBILE CALENDAR (Daily hourly grid)                                 -->
    <!-- SPECIFICATION.md line 394                                           -->
    <!-- =================================================================== -->
    <div class="flex flex-col space-y-4 md:hidden">
      <!-- Mobile Top Bar -->
      <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="mobile-prev-day-btn"
              class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              @click="prevMobileDay"
            >
              &lt;
            </button>
            <input
              v-model="selectedDate"
              type="date"
              aria-label="Seleziona giorno"
              class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900"
            />
            <button
              type="button"
              data-testid="mobile-next-day-btn"
              class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              @click="nextMobileDay"
            >
              &gt;
            </button>
          </div>

          <NuxtLink
            v-if="canWrite"
            :to="{ path: '/worker/schedules/new', query: { date: selectedDate } }"
            data-testid="mobile-create-schedule-btn"
            class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700"
          >
            + Crea lezione
          </NuxtLink>
        </div>

        <div class="flex items-center justify-between text-xs text-slate-600">
          <span class="font-semibold capitalize text-slate-800">{{ mobileDayLabel }}</span>
          <button
            type="button"
            class="font-semibold text-indigo-600 hover:text-indigo-800"
            @click="goToToday"
          >
            Oggi
          </button>
        </div>
      </div>

      <!-- Mobile Daily Hourly Grid -->
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-200">
        <div
          v-for="hour in displayHours"
          :key="`mob-${hour}`"
          class="flex min-h-14"
        >
          <div class="w-16 shrink-0 border-r border-slate-200 bg-slate-50 p-2 text-center text-xs font-semibold text-slate-500">
            {{ formatHourLabel(hour) }}
          </div>
          <div
            class="flex-1 p-1.5 space-y-1.5"
            :class="canWrite ? 'cursor-pointer active:bg-slate-50' : ''"
            @click.self="handleEmptySlotClick(selectedDate, hour)"
          >
            <button
              v-for="sched in getSchedulesForDateAndHour(selectedDate, hour)"
              :key="sched.id"
              type="button"
              class="block w-full rounded-lg border p-2.5 text-left text-xs transition"
              :class="[
                getClassColorStyle(sched.class?.color).calendarCardClass,
                sched.status === 'CANCELLED_BY_PROVIDER' || sched.status === 'CANCELLED_LOW_ENROLLMENT'
                  ? 'opacity-50 line-through'
                  : '',
              ]"
              @click.stop="handleScheduleClick(sched.id)"
            >
              <div class="flex items-center justify-between font-bold">
                <span>{{ sched.class?.name ?? 'Corso' }}</span>
                <span>{{ formatCenterTimeRange(sched.startDate, sched.durationMinutes, centerTimezone) }}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[11px] opacity-90">
                <span>
                  {{ sched.instructor ? `${sched.instructor.name} ${sched.instructor.surname}` : 'Senza istruttore' }}
                </span>
                <span>
                  Iscritti: {{ sched.enrolledCount }}/{{ sched.availableSpots ?? '∞' }}
                  ({{ getScheduleStatusStyle(sched.status).label }})
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="pending" class="text-center text-xs text-slate-500">
      Aggiornamento calendario in corso...
    </div>
  </div>
</template>

