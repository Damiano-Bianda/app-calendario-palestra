<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { CustomerScheduleItem } from '~/components/customer/UserCourseCard.vue'
import {
  addDaysToLocalDate,
  canNavigateToPreviousCustomerDay,
  extractApiErrorMessage,
  formatLocalDateHeaderIt,
  getTodayInCenterTimezone,
} from '~/utils/ui-formatters'

definePageMeta({
  layout: 'customer',
  middleware: 'customer',
})

const { user, activeCenter, centerTimezone } = useAuth()

const todayDate = computed(() => getTodayInCenterTimezone(centerTimezone.value))
const selectedDate = ref<string>(todayDate.value)

const schedules = ref<CustomerScheduleItem[]>([])
const loading = ref(false)
const actionScheduleId = ref<string | null>(null)
const errorMessage = ref('')
const feedbackMessage = ref('')

const canGoPrevious = computed(() =>
  canNavigateToPreviousCustomerDay(selectedDate.value, todayDate.value),
)

const formattedDayHeader = computed(() =>
  formatLocalDateHeaderIt(selectedDate.value, centerTimezone.value),
)

const isTodaySelected = computed(() => selectedDate.value === todayDate.value)

async function loadDailySchedules() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await $fetch<{ schedules: CustomerScheduleItem[] }>('/api/schedules', {
      query: {
        date: selectedDate.value,
        view: 'day',
        mode: 'customer',
      },
    })
    schedules.value = res.schedules
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile caricare le lezioni del giorno selezionato.',
    )
  } finally {
    loading.value = false
  }
}

function goToPreviousDay() {
  if (!canGoPrevious.value) return
  const candidate = addDaysToLocalDate(selectedDate.value, -1)
  selectedDate.value = candidate < todayDate.value ? todayDate.value : candidate
}

function goToNextDay() {
  selectedDate.value = addDaysToLocalDate(selectedDate.value, 1)
}

function goToToday() {
  selectedDate.value = todayDate.value
}

function handleDateInput(event: Event) {
  const target = event.target as HTMLInputElement
  const raw = target.value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return
  // Enforce specification rule: cannot navigate to days before today
  selectedDate.value = raw < todayDate.value ? todayDate.value : raw
}

async function handleEnroll(scheduleId: string) {
  errorMessage.value = ''
  feedbackMessage.value = ''
  actionScheduleId.value = scheduleId

  try {
    const res = await $fetch<{
      isQueued: boolean
      schedule: CustomerScheduleItem
    }>(`/api/schedules/${scheduleId}/enroll`, {
      method: 'POST',
      body: {},
    })

    const idx = schedules.value.findIndex((s) => s.id === scheduleId)
    if (idx !== -1 && res.schedule) {
      schedules.value[idx] = res.schedule
    } else {
      await loadDailySchedules()
    }

    feedbackMessage.value = res.isQueued
      ? 'La lezione è al completo: sei stato inserito in coda.'
      : 'Iscrizione alla lezione confermata!'
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile completare l’iscrizione alla lezione.',
    )
  } finally {
    actionScheduleId.value = null
  }
}

async function handleUnenroll(scheduleId: string) {
  if (!user.value?.id) return
  errorMessage.value = ''
  feedbackMessage.value = ''
  actionScheduleId.value = scheduleId

  try {
    const res = await $fetch<{
      success: boolean
      wasQueued: boolean
      schedule: CustomerScheduleItem
    }>(`/api/schedules/${scheduleId}/enroll/${user.value.id}`, {
      method: 'DELETE',
    })

    const idx = schedules.value.findIndex((s) => s.id === scheduleId)
    if (idx !== -1 && res.schedule) {
      schedules.value[idx] = res.schedule
    } else {
      await loadDailySchedules()
    }

    feedbackMessage.value = res.wasQueued
      ? 'Ti sei rimosso dalla coda per questa lezione.'
      : 'Disiscrizione completata. L’entrata è stata restituita alla tua sottoscrizione.'
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile annullare l’iscrizione alla lezione.',
    )
  } finally {
    actionScheduleId.value = null
  }
}

watch(
  todayDate,
  (newToday) => {
    if (selectedDate.value < newToday) {
      selectedDate.value = newToday
    }
  },
)

watch(
  [selectedDate, () => activeCenter.value?.centerId],
  () => {
    feedbackMessage.value = ''
    loadDailySchedules()
  },
)

onMounted(() => {
  if (selectedDate.value < todayDate.value) {
    selectedDate.value = todayDate.value
  }
  loadDailySchedules()
})
</script>

<template>
  <div class="space-y-5">
    <!-- Top Header & Daily Date Navigator (SPECIFICATION.md line 388) -->
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-xl font-bold text-slate-900">
            Lezioni del giorno
          </h1>
          <p class="mt-0.5 text-xs text-slate-500">
            Sede: <span class="font-medium text-slate-700">{{ activeCenter?.centerName ?? '—' }}</span>
            • Orari nel fuso <span class="font-medium text-slate-700">{{ centerTimezone }}</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="!isTodaySelected"
            type="button"
            class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            @click="goToToday"
          >
            Oggi
          </button>

          <input
            type="date"
            :value="selectedDate"
            :min="todayDate"
            aria-label="Seleziona data"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            @change="handleDateInput"
          />
        </div>
      </div>

      <!-- Day bar with < > buttons -->
      <div class="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 border border-slate-200">
        <button
          type="button"
          data-testid="prev-day-btn"
          :disabled="!canGoPrevious"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Giorno precedente"
          aria-label="Giorno precedente"
          @click="goToPreviousDay"
        >
          &lt;
        </button>

        <div class="min-w-0 text-center">
          <p
            data-testid="selected-day-label"
            class="truncate text-sm font-bold capitalize text-slate-900 sm:text-base"
          >
            {{ formattedDayHeader }}
          </p>
          <p v-if="isTodaySelected" class="text-[11px] font-semibold text-indigo-600">
            Giorno corrente
          </p>
        </div>

        <button
          type="button"
          data-testid="next-day-btn"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100"
          title="Giorno successivo"
          aria-label="Giorno successivo"
          @click="goToNextDay"
        >
          &gt;
        </button>
      </div>
    </div>

    <!-- Error / Feedback Banners -->
    <div
      v-if="errorMessage"
      role="alert"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="feedbackMessage"
      role="status"
      class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
    >
      {{ feedbackMessage }}
    </div>

    <!-- Daily Course List -->
    <div v-if="loading" class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
      Caricamento lezioni in corso...
    </div>

    <div
      v-else-if="schedules.length === 0"
      class="rounded-xl border border-slate-200 bg-white p-8 text-center"
    >
      <p class="text-sm font-medium text-slate-700">
        Nessuna lezione programmata per questa giornata.
      </p>
      <p class="mt-1 text-xs text-slate-500">
        Usa le frecce &lt; &gt; in alto per consultare i giorni successivi.
      </p>
    </div>

    <div v-else class="space-y-3">
      <CustomerUserCourseCard
        v-for="item in schedules"
        :key="item.id"
        :schedule="item"
        :timezone="centerTimezone"
        :readonly="false"
        :loading="actionScheduleId === item.id"
        @enroll="handleEnroll"
        @unenroll="handleUnenroll"
      />
    </div>
  </div>
</template>

