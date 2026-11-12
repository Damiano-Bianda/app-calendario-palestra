<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { EnrichedScheduleResponse } from '../../../server/utils/domain-queries'
import {
  createRecurringSchedulesSchema,
  scheduleEmailSchema,
  updateScheduleSchema,
} from '../../../shared/schemas/schedules'
import {
  DELETABLE_SCHEDULE_STATUSES,
  EDITABLE_SCHEDULE_STATUSES,
} from '../../../shared/utils/schedule-status'
import {
  formatCenterDateTime,
  formatCenterTimeRange,
  localDateTimeToUtcIso,
  utcIsoToLocalParts,
} from '../../../shared/utils/timezone'
import {
  extractApiErrorMessage,
  getTodayInCenterTimezone,
  hoursAndMinutesToTotalMinutes,
  ITALIAN_DAYS_OF_WEEK,
  minutesToHoursAndMinutes,
} from '~/utils/ui-formatters'

export interface ParticipantRecord {
  userScheduleId: string
  userId: string
  userSubscriptionId: string
  name: string
  surname: string
  email: string
  phoneNumber: string
  enrolledAt?: string
  queuedAt?: string
  queuePosition?: number
}

export interface SimpleClassOption {
  id: string
  name: string
  color: string
}

export interface SimpleUserOption {
  id: string
  name: string
  surname: string
  email: string
  phoneNumber: string
  isInstructor: boolean
}

const props = defineProps<{
  mode: 'create' | 'edit'
  initialSchedule?: EnrichedScheduleResponse | null
  enrolledUsers?: ParticipantRecord[]
  queuedUsers?: ParticipantRecord[]
  classesOptions: SimpleClassOption[]
  usersOptions: SimpleUserOption[]
  prefillDate?: string
  prefillTime?: string
  readOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const { user, canWrite, isInstructor, centerTimezone } = useAuth()

const instructorsOptions = computed(() =>
  props.usersOptions.filter((u) => u.isInstructor),
)

// Can the current user edit the schedule form fields?
const isFormReadOnly = computed(() => {
  if (props.readOnly || !canWrite.value) return true
  if (props.mode === 'edit' && props.initialSchedule) {
    return !EDITABLE_SCHEDULE_STATUSES.includes(props.initialSchedule.status)
  }
  return false
})

// Can the current user delete/cancel this schedule?
const canDeleteSchedule = computed(() => {
  if (props.readOnly || !canWrite.value || props.mode !== 'edit' || !props.initialSchedule) {
    return false
  }
  return DELETABLE_SCHEDULE_STATUSES.includes(props.initialSchedule.status)
})

const shouldPromptNotifyOnDelete = computed(() => {
  if (!props.initialSchedule) return false
  const st = props.initialSchedule.status
  return (
    (st === 'PUBLISHED' || st === 'ENROLLING' || st === 'UPCOMING') &&
    props.initialSchedule.enrolledCount > 0
  )
})

// Can the current user send an email to the enrolled participants of this lesson?
// SPECIFICATION.md lines 25, 395, 473: (Assistant) Manager OR the Instructor assigned to this lesson
const canEmailParticipants = computed(() => {
  if (props.mode !== 'edit' || !props.initialSchedule) return false
  if (canWrite.value) return true
  if (isInstructor.value && props.initialSchedule.instructorId === user.value?.id) {
    return true
  }
  return false
})

function computeWeekdayFromYmd(ymd: string): number {
  const parts = ymd.split('-').map((n) => Number.parseInt(n, 10))
  const dt = new Date(Date.UTC(parts[0] || 2026, (parts[1] || 1) - 1, parts[2] || 1))
  return dt.getUTCDay()
}

const defaultToday = getTodayInCenterTimezone(centerTimezone.value)
const initialDate = props.prefillDate && /^\d{4}-\d{2}-\d{2}$/.test(props.prefillDate)
  ? props.prefillDate
  : defaultToday
const initialTime = props.prefillTime && /^\d{2}:\d{2}$/.test(props.prefillTime)
  ? props.prefillTime
  : '18:00'

const form = reactive({
  classId: props.classesOptions[0]?.id ?? '',
  rangeStartDate: initialDate,
  rangeEndDate: initialDate,
  localDate: initialDate,
  daysOfWeek: [computeWeekdayFromYmd(initialDate)] as number[],
  startTime: initialTime,
  durationHours: '1',
  durationMinutesPart: '0',
  minimumSpots: '1',
  availableSpots: '',
  instructorId: '',
  pubHours: '',
  pubMinutes: '',
  openHours: '',
  openMinutes: '',
  closeHours: '',
  closeMinutes: '',
})

watch(
  () => props.initialSchedule,
  (sched) => {
    if (!sched) return
    const localParts = utcIsoToLocalParts(sched.startDate, centerTimezone.value)
    const dur = minutesToHoursAndMinutes(sched.durationMinutes)
    const pub = minutesToHoursAndMinutes(sched.publicationMinutesBefore)
    const open = minutesToHoursAndMinutes(sched.registrationOpenMinutesBefore)
    const close = minutesToHoursAndMinutes(sched.registrationCloseMinutesBefore)

    form.classId = sched.classId
    form.localDate = localParts.date
    form.startTime = localParts.time
    form.durationHours = dur.hours
    form.durationMinutesPart = dur.minutes
    form.minimumSpots = String(sched.minimumSpots)
    form.availableSpots = sched.availableSpots !== null ? String(sched.availableSpots) : ''
    form.instructorId = sched.instructorId ?? ''
    form.pubHours = pub.hours
    form.pubMinutes = pub.minutes
    form.openHours = open.hours
    form.openMinutes = open.minutes
    form.closeHours = close.hours
    form.closeMinutes = close.minutes
  },
  { immediate: true },
)

const fieldErrors = ref<Record<string, string>>({})
const generalError = ref('')
const successMessage = ref('')
const submitting = ref(false)
const deleting = ref(false)
const showDeleteDialog = ref(false)

// Enrollment management by Manager / Assistant Manager
const selectedCustomerId = ref('')
const enrollingCustomer = ref(false)
const unenrollingUserId = ref<string | null>(null)
const enrollmentError = ref('')
const enrollmentSuccess = ref('')

// Email to enrolled users modal
const showEmailModal = ref(false)
const emailMessage = ref('')
const sendingEmail = ref(false)
const emailError = ref('')

const availableCustomersForEnrollment = computed(() => {
  const existingIds = new Set<string>([
    ...(props.enrolledUsers ?? []).map((u) => u.userId),
    ...(props.queuedUsers ?? []).map((u) => u.userId),
  ])
  return props.usersOptions.filter((u) => !existingIds.has(u.id))
})

function toggleDayOfWeek(dayValue: number) {
  if (isFormReadOnly.value) return
  const idx = form.daysOfWeek.indexOf(dayValue)
  if (idx >= 0) {
    form.daysOfWeek.splice(idx, 1)
  } else {
    form.daysOfWeek.push(dayValue)
  }
}

async function handleSubmit() {
  if (isFormReadOnly.value) return
  fieldErrors.value = {}
  generalError.value = ''
  successMessage.value = ''

  const durationMinutes = hoursAndMinutesToTotalMinutes(
    form.durationHours,
    form.durationMinutesPart,
  )
  const minimumSpots = Number.parseInt(String(form.minimumSpots).trim(), 10)
  const availableSpotsStr = String(form.availableSpots ?? '').trim()
  const availableSpots =
    availableSpotsStr === '' ? null : Number.parseInt(availableSpotsStr, 10)

  const publicationMinutesBefore = hoursAndMinutesToTotalMinutes(
    form.pubHours,
    form.pubMinutes,
  )
  const registrationOpenMinutesBefore = hoursAndMinutesToTotalMinutes(
    form.openHours,
    form.openMinutes,
  )
  const registrationCloseMinutesBefore = hoursAndMinutesToTotalMinutes(
    form.closeHours,
    form.closeMinutes,
  )

  if (props.mode === 'create') {
    const payload = {
      classId: form.classId,
      rangeStartDate: form.rangeStartDate,
      rangeEndDate: form.rangeEndDate,
      daysOfWeek: form.daysOfWeek,
      startTime: form.startTime,
      durationMinutes: durationMinutes ?? 0,
      minimumSpots,
      availableSpots,
      instructorId: form.instructorId || null,
      publicationMinutesBefore,
      registrationOpenMinutesBefore,
      registrationCloseMinutesBefore,
    }

    const parsed = createRecurringSchedulesSchema.safeParse(payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'general')
        if (!fieldErrors.value[key]) {
          fieldErrors.value[key] = issue.message
        }
      }
      return
    }

    submitting.value = true
    try {
      const res = await $fetch<{ createdCount: number }>('/api/schedules', {
        method: 'POST',
        body: parsed.data,
      })
      successMessage.value = `Create ${res.createdCount} lezioni con successo.`
      await navigateTo('/worker/calendar')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        'Impossibile creare le lezioni. Verifica i parametri inseriti.',
      )
    } finally {
      submitting.value = false
    }
  } else if (props.initialSchedule) {
    let startDateUtc: string
    try {
      startDateUtc = localDateTimeToUtcIso(
        form.localDate,
        form.startTime,
        centerTimezone.value,
      )
    } catch (err) {
      fieldErrors.value.startDate =
        err instanceof Error ? err.message : 'Data o ora locale non valida.'
      return
    }

    const payload = {
      classId: form.classId,
      instructorId: form.instructorId || null,
      startDate: startDateUtc,
      durationMinutes: durationMinutes ?? 0,
      minimumSpots,
      availableSpots,
      publicationMinutesBefore,
      registrationOpenMinutesBefore,
      registrationCloseMinutesBefore,
    }

    const parsed = updateScheduleSchema.safeParse(payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'general')
        if (!fieldErrors.value[key]) {
          fieldErrors.value[key] = issue.message
        }
      }
      return
    }

    submitting.value = true
    try {
      await $fetch(`/api/schedules/${props.initialSchedule.id}`, {
        method: 'PUT',
        body: parsed.data,
      })
      successMessage.value = 'Lezione modificata con successo.'
      emit('refresh')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        'Impossibile salvare le modifiche alla lezione.',
      )
    } finally {
      submitting.value = false
    }
  }
}

async function handleConfirmDelete(notification: {
  notifyEnrolled: boolean
  notificationMessage: string | null
}) {
  if (!props.initialSchedule || !canDeleteSchedule.value) return
  deleting.value = true
  generalError.value = ''

  try {
    await $fetch(`/api/schedules/${props.initialSchedule.id}`, {
      method: 'DELETE',
      body: {
        notifyEnrolled: notification.notifyEnrolled,
        notificationMessage: notification.notificationMessage,
      },
    })
    showDeleteDialog.value = false
    await navigateTo('/worker/calendar')
  } catch (err) {
    showDeleteDialog.value = false
    generalError.value = extractApiErrorMessage(
      err,
      'Impossibile eliminare la lezione.',
    )
  } finally {
    deleting.value = false
  }
}

async function handleManagerEnroll() {
  if (!props.initialSchedule || !selectedCustomerId.value || !canWrite.value) return
  enrollingCustomer.value = true
  enrollmentError.value = ''
  enrollmentSuccess.value = ''

  try {
    const res = await $fetch<{ isQueued: boolean }>(
      `/api/schedules/${props.initialSchedule.id}/enroll`,
      {
        method: 'POST',
        body: { userId: selectedCustomerId.value },
      },
    )
    selectedCustomerId.value = ''
    enrollmentSuccess.value = res.isQueued
      ? 'Cliente inserito in coda con successo (inviata email di notifica).'
      : 'Cliente iscritto alla lezione con successo (inviata email di notifica).'
    emit('refresh')
  } catch (err) {
    enrollmentError.value = extractApiErrorMessage(
      err,
      'Impossibile iscrivere il cliente selezionato.',
    )
  } finally {
    enrollingCustomer.value = false
  }
}

async function handleManagerUnenroll(targetUserId: string) {
  if (!props.initialSchedule || !canWrite.value) return
  unenrollingUserId.value = targetUserId
  enrollmentError.value = ''
  enrollmentSuccess.value = ''

  try {
    const res = await $fetch<{ promotedUserId: string | null }>(
      `/api/schedules/${props.initialSchedule.id}/enroll/${targetUserId}`,
      {
        method: 'DELETE',
      },
    )
    enrollmentSuccess.value = res.promotedUserId
      ? 'Cliente disiscritto. Il primo utente in coda è stato promosso e avvisato via email.'
      : 'Cliente disiscritto con successo.'
    emit('refresh')
  } catch (err) {
    enrollmentError.value = extractApiErrorMessage(
      err,
      'Impossibile disiscrivere il cliente.',
    )
  } finally {
    unenrollingUserId.value = null
  }
}

async function handleSendParticipantsEmail() {
  if (!props.initialSchedule || !canEmailParticipants.value) return
  emailError.value = ''

  const parsed = scheduleEmailSchema.safeParse({
    message: emailMessage.value.trim(),
  })
  if (!parsed.success) {
    emailError.value = parsed.error.issues[0]?.message ?? 'Inserisci un messaggio valido.'
    return
  }

  sendingEmail.value = true
  try {
    const res = await $fetch<{ sentCount: number }>(
      `/api/schedules/${props.initialSchedule.id}/email`,
      {
        method: 'POST',
        body: parsed.data,
      },
    )
    showEmailModal.value = false
    emailMessage.value = ''
    enrollmentSuccess.value = `Email inviata con successo a ${res.sentCount} iscritti.`
  } catch (err) {
    emailError.value = extractApiErrorMessage(
      err,
      "Impossibile inviare l'email agli iscritti.",
    )
  } finally {
    sendingEmail.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-8">
    <!-- Top Header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-3 text-xs font-semibold text-indigo-600">
          <NuxtLink to="/worker/calendar" class="hover:text-indigo-800">
            ← Calendario
          </NuxtLink>
          <span class="text-slate-300">|</span>
          <NuxtLink to="/worker/schedules" class="hover:text-indigo-800">
            Lista lezioni
          </NuxtLink>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold text-slate-900">
            {{
              mode === 'create'
                ? 'Crea lezioni'
                : isFormReadOnly
                  ? 'Dettaglio lezione'
                  : 'Modifica lezione'
            }}
          </h1>
          <ScheduleStatusBadge
            v-if="mode === 'edit' && initialSchedule"
            :status="initialSchedule.status"
          />
        </div>
      </div>

      <!-- SPECIFICATION.md line 395: "In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma" -->
      <button
        v-if="canDeleteSchedule"
        type="button"
        data-testid="delete-schedule-btn"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
        @click="showDeleteDialog = true"
      >
        Elimina lezione
      </button>
    </div>

    <!-- Status Notice when editing is locked by status -->
    <div
      v-if="mode === 'edit' && canWrite && isFormReadOnly && initialSchedule"
      class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      La modifica dei parametri della lezione è consentita solo negli stati <strong>Bozza</strong> o
      <strong>Pubblicata</strong> (stato attuale:
      <strong>{{ initialSchedule.status }}</strong>).
    </div>

    <div
      v-if="generalError"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ generalError }}
    </div>

    <div
      v-if="successMessage"
      class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
    >
      {{ successMessage }}
    </div>

    <!-- Schedule Form -->
    <form
      class="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
      @submit.prevent="handleSubmit"
    >
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <!-- Corso (obbligatorio) -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Corso <span v-if="!isFormReadOnly" class="text-red-600">*</span>
          </label>
          <select
            v-model="form.classId"
            :disabled="isFormReadOnly"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          >
            <option value="" disabled>Seleziona un corso...</option>
            <option v-for="cls in classesOptions" :key="cls.id" :value="cls.id">
              {{ cls.name }}
            </option>
          </select>
          <p v-if="fieldErrors.classId" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.classId }}
          </p>
        </div>

        <!-- Istruttore (facoltativo) -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Istruttore <span class="text-xs font-normal text-slate-500">(facoltativo)</span>
          </label>
          <select
            v-model="form.instructorId"
            :disabled="isFormReadOnly"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          >
            <option value="">Nessun istruttore assegnato</option>
            <option
              v-for="inst in instructorsOptions"
              :key="inst.id"
              :value="inst.id"
            >
              {{ inst.name }} {{ inst.surname }} ({{ inst.email }})
            </option>
          </select>
          <p v-if="fieldErrors.instructorId" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.instructorId }}
          </p>
        </div>
      </div>

      <!-- Recurring Dates & Days of Week (Create mode) -->
      <div v-if="mode === 'create'" class="space-y-5 border-t border-slate-200 pt-5">
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label class="block text-sm font-semibold text-slate-800">
              Data d'inizio <span class="text-red-600">*</span>
            </label>
            <input
              v-model="form.rangeStartDate"
              type="date"
              :disabled="isFormReadOnly"
              class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <p v-if="fieldErrors.rangeStartDate" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.rangeStartDate }}
            </p>
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-800">
              Data di fine <span class="text-red-600">*</span>
            </label>
            <input
              v-model="form.rangeEndDate"
              type="date"
              :disabled="isFormReadOnly"
              class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <p v-if="fieldErrors.rangeEndDate" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.rangeEndDate }}
            </p>
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-800">
              Ora d'inizio ({{ centerTimezone }}) <span class="text-red-600">*</span>
            </label>
            <input
              v-model="form.startTime"
              type="time"
              step="300"
              :disabled="isFormReadOnly"
              class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <p v-if="fieldErrors.startTime" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.startTime }}
            </p>
          </div>
        </div>

        <!-- Giorni della settimana -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Giorni della settimana <span class="text-red-600">*</span>
          </label>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="day in ITALIAN_DAYS_OF_WEEK"
              :key="day.value"
              type="button"
              :disabled="isFormReadOnly"
              class="rounded-lg border px-3.5 py-2 text-xs font-semibold transition"
              :class="
                form.daysOfWeek.includes(day.value)
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-2xs'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              "
              @click="toggleDayOfWeek(day.value)"
            >
              {{ day.label }}
            </button>
          </div>
          <p v-if="fieldErrors.daysOfWeek" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.daysOfWeek }}
          </p>
        </div>
      </div>

      <!-- Single Date & Time (Edit mode) -->
      <div v-else class="grid grid-cols-1 gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2">
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Data lezione ({{ centerTimezone }}) <span v-if="!isFormReadOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.localDate"
            type="date"
            :disabled="isFormReadOnly"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="fieldErrors.startDate" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.startDate }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Ora d'inizio ({{ centerTimezone }}) <span v-if="!isFormReadOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.startTime"
            type="time"
            step="300"
            :disabled="isFormReadOnly"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
        </div>
      </div>

      <!-- Duration & Spots -->
      <div class="grid grid-cols-1 gap-5 border-t border-slate-200 pt-5 sm:grid-cols-3">
        <!-- Durata in ore e minuti -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Durata (ore e minuti) <span v-if="!isFormReadOnly" class="text-red-600">*</span>
          </label>
          <div class="mt-1.5 grid grid-cols-2 gap-2">
            <div>
              <input
                v-model="form.durationHours"
                type="number"
                min="0"
                step="1"
                :disabled="isFormReadOnly"
                placeholder="Ore"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              />
              <span class="mt-0.5 block text-[11px] text-slate-500">Ore</span>
            </div>
            <div>
              <input
                v-model="form.durationMinutesPart"
                type="number"
                min="0"
                max="55"
                step="5"
                :disabled="isFormReadOnly"
                placeholder="Minuti"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              />
              <span class="mt-0.5 block text-[11px] text-slate-500">Minuti (step 5)</span>
            </div>
          </div>
          <p v-if="fieldErrors.durationMinutes" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.durationMinutes }}
          </p>
        </div>

        <!-- Posti minimi -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Numero di posti minimo <span v-if="!isFormReadOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.minimumSpots"
            type="number"
            min="1"
            step="1"
            :disabled="isFormReadOnly"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
          />
          <p class="mt-0.5 text-[11px] text-slate-500">
            Minimo iscritti per confermare la lezione alla chiusura iscrizioni.
          </p>
          <p v-if="fieldErrors.minimumSpots" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.minimumSpots }}
          </p>
        </div>

        <!-- Posti massimi (facoltativo: vuoto = illimitati) -->
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Numero di posti massimo <span class="text-xs font-normal text-slate-500">(facoltativo)</span>
          </label>
          <input
            v-model="form.availableSpots"
            type="number"
            min="1"
            step="1"
            :disabled="isFormReadOnly"
            placeholder="Illimitati se vuoto"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
          />
          <p class="mt-0.5 text-[11px] text-slate-500">
            Lascia vuoto per posti illimitati.
          </p>
          <p v-if="fieldErrors.availableSpots" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.availableSpots }}
          </p>
        </div>
      </div>

      <!-- Optional Timing Offsets (Publication, Registration Open, Registration Close) -->
      <div class="space-y-4 border-t border-slate-200 pt-5">
        <h2 class="text-sm font-bold text-slate-900">
          Tempistiche di visibilità e iscrizione
          <span class="text-xs font-normal text-slate-500">(facoltative: lascia vuoto per default)</span>
        </h2>

        <div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <!-- Visibilità / Pubblicazione -->
          <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
            <label class="block text-xs font-semibold text-slate-800">
              Visibile prima dell'inizio
            </label>
            <p class="mt-0.5 text-[11px] text-slate-500">
              Vuoto = subito visibile ai clienti
            </p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <div>
                <input
                  v-model="form.pubHours"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="isFormReadOnly"
                  placeholder="Ore"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Ore</span>
              </div>
              <div>
                <input
                  v-model="form.pubMinutes"
                  type="number"
                  min="0"
                  max="55"
                  step="5"
                  :disabled="isFormReadOnly"
                  placeholder="Min"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Minuti (step 5)</span>
              </div>
            </div>
            <p v-if="fieldErrors.publicationMinutesBefore" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.publicationMinutesBefore }}
            </p>
          </div>

          <!-- Apertura iscrizioni -->
          <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
            <label class="block text-xs font-semibold text-slate-800">
              Apertura iscrizioni prima dell'inizio
            </label>
            <p class="mt-0.5 text-[11px] text-slate-500">
              Vuoto = subito iscrivibile
            </p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <div>
                <input
                  v-model="form.openHours"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="isFormReadOnly"
                  placeholder="Ore"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Ore</span>
              </div>
              <div>
                <input
                  v-model="form.openMinutes"
                  type="number"
                  min="0"
                  max="55"
                  step="5"
                  :disabled="isFormReadOnly"
                  placeholder="Min"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Minuti (step 5)</span>
              </div>
            </div>
            <p v-if="fieldErrors.registrationOpenMinutesBefore" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.registrationOpenMinutesBefore }}
            </p>
          </div>

          <!-- Chiusura iscrizioni -->
          <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
            <label class="block text-xs font-semibold text-slate-800">
              Chiusura iscrizioni prima dell'inizio
            </label>
            <p class="mt-0.5 text-[11px] text-slate-500">
              Vuoto = fino all'inizio della lezione
            </p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <div>
                <input
                  v-model="form.closeHours"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="isFormReadOnly"
                  placeholder="Ore"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Ore</span>
              </div>
              <div>
                <input
                  v-model="form.closeMinutes"
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  :disabled="isFormReadOnly"
                  placeholder="Min"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                />
                <span class="text-[10px] text-slate-500">Minuti</span>
              </div>
            </div>
            <p v-if="fieldErrors.registrationCloseMinutesBefore" class="mt-1 text-xs font-medium text-red-600">
              {{ fieldErrors.registrationCloseMinutesBefore }}
            </p>
          </div>
        </div>
      </div>

      <!-- Submit Buttons (hidden if read-only) -->
      <div v-if="!isFormReadOnly" class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <NuxtLink
          to="/worker/calendar"
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Annulla
        </NuxtLink>
        <button
          type="submit"
          :disabled="submitting"
          class="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ submitting ? 'Salvataggio...' : 'Salva' }}
        </button>
      </div>
    </form>

    <!-- =================================================================== -->
    <!-- ENROLLED USERS & QUEUE SECTION (Edit/Detail mode)                   -->
    <!-- SPECIFICATION.md line 395                                           -->
    <!-- =================================================================== -->
    <div
      v-if="mode === 'edit' && initialSchedule"
      class="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
    >
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 class="text-lg font-bold text-slate-900">
            Iscritti e Coda d'attesa
          </h2>
          <p class="mt-0.5 text-xs text-slate-600">
            Orario lezione:
            <strong>{{ formatCenterDateTime(initialSchedule.startDate, centerTimezone) }}</strong>
            ({{ formatCenterTimeRange(initialSchedule.startDate, initialSchedule.durationMinutes, centerTimezone) }})
            · Posti occupati:
            <strong>{{ initialSchedule.enrolledCount }} / {{ initialSchedule.availableSpots ?? 'Illimitati' }}</strong>
            · In coda: <strong>{{ initialSchedule.queuedCount }}</strong>
          </p>
        </div>

        <!-- Button to email enrolled participants (Manager, Assistant Manager, or assigned Instructor) -->
        <button
          v-if="canEmailParticipants && (enrolledUsers?.length ?? 0) > 0"
          type="button"
          data-testid="email-enrolled-btn"
          class="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
          @click="showEmailModal = true"
        >
          ✉ Invia email agli iscritti ({{ enrolledUsers?.length ?? 0 }})
        </button>
      </div>

      <div
        v-if="enrollmentError"
        class="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
      >
        {{ enrollmentError }}
      </div>

      <div
        v-if="enrollmentSuccess"
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800"
      >
        {{ enrollmentSuccess }}
      </div>

      <!-- Manager Enrollment Control (only when status === 'ENROLLING' and canWrite) -->
      <div
        v-if="canWrite && initialSchedule.status === 'ENROLLING'"
        class="rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <label class="block text-xs font-semibold text-slate-700 mb-2">
          Iscrivi un cliente a questa lezione (o in coda se piena)
        </label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <select
            v-model="selectedCustomerId"
            class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Seleziona cliente...</option>
            <option
              v-for="cust in availableCustomersForEnrollment"
              :key="cust.id"
              :value="cust.id"
            >
              {{ cust.surname }} {{ cust.name }} — {{ cust.email }}
            </option>
          </select>
          <button
            type="button"
            :disabled="!selectedCustomerId || enrollingCustomer"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
            @click="handleManagerEnroll"
          >
            {{ enrollingCustomer ? 'Iscrizione...' : 'Iscrivi cliente' }}
          </button>
        </div>
      </div>

      <!-- Enrolled List -->
      <div>
        <h3 class="text-sm font-bold text-slate-800 mb-2">
          Clienti Iscritti ({{ enrolledUsers?.length ?? 0 }})
        </h3>
        <div
          v-if="!enrolledUsers || enrolledUsers.length === 0"
          class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500"
        >
          Nessun cliente iscritto a questa lezione.
        </div>
        <div v-else class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead class="bg-slate-50 font-semibold uppercase text-slate-600">
              <tr>
                <th class="px-3.5 py-2.5">Cliente</th>
                <th class="px-3.5 py-2.5">Email</th>
                <th class="px-3.5 py-2.5">Telefono</th>
                <th class="px-3.5 py-2.5">Iscritto il</th>
                <th v-if="canWrite && initialSchedule.status === 'ENROLLING'" class="px-3.5 py-2.5 text-right">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 bg-white">
              <tr v-for="p in enrolledUsers" :key="p.userScheduleId">
                <td class="px-3.5 py-2.5 font-semibold text-slate-900">
                  {{ p.surname }} {{ p.name }}
                </td>
                <td class="px-3.5 py-2.5 text-slate-600">{{ p.email }}</td>
                <td class="px-3.5 py-2.5 text-slate-600">{{ p.phoneNumber }}</td>
                <td class="px-3.5 py-2.5 text-slate-500">
                  {{ p.enrolledAt ? formatCenterDateTime(p.enrolledAt, centerTimezone) : '—' }}
                </td>
                <td
                  v-if="canWrite && initialSchedule.status === 'ENROLLING'"
                  class="px-3.5 py-2.5 text-right"
                >
                  <button
                    type="button"
                    :disabled="unenrollingUserId === p.userId"
                    class="rounded border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    @click="handleManagerUnenroll(p.userId)"
                  >
                    {{ unenrollingUserId === p.userId ? '...' : 'Disiscrivi' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Queue List -->
      <div>
        <h3 class="text-sm font-bold text-slate-800 mb-2">
          Coda d'attesa ({{ queuedUsers?.length ?? 0 }})
        </h3>
        <div
          v-if="!queuedUsers || queuedUsers.length === 0"
          class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500"
        >
          Nessun cliente in coda.
        </div>
        <div v-else class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead class="bg-slate-50 font-semibold uppercase text-slate-600">
              <tr>
                <th class="px-3.5 py-2.5">Pos.</th>
                <th class="px-3.5 py-2.5">Cliente</th>
                <th class="px-3.5 py-2.5">Email</th>
                <th class="px-3.5 py-2.5">Telefono</th>
                <th class="px-3.5 py-2.5">In coda dal</th>
                <th v-if="canWrite && initialSchedule.status === 'ENROLLING'" class="px-3.5 py-2.5 text-right">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 bg-white">
              <tr v-for="q in queuedUsers" :key="q.userScheduleId">
                <td class="px-3.5 py-2.5 font-bold text-amber-700">#{{ q.queuePosition }}</td>
                <td class="px-3.5 py-2.5 font-semibold text-slate-900">
                  {{ q.surname }} {{ q.name }}
                </td>
                <td class="px-3.5 py-2.5 text-slate-600">{{ q.email }}</td>
                <td class="px-3.5 py-2.5 text-slate-600">{{ q.phoneNumber }}</td>
                <td class="px-3.5 py-2.5 text-slate-500">
                  {{ q.queuedAt ? formatCenterDateTime(q.queuedAt, centerTimezone) : '—' }}
                </td>
                <td
                  v-if="canWrite && initialSchedule.status === 'ENROLLING'"
                  class="px-3.5 py-2.5 text-right"
                >
                  <button
                    type="button"
                    :disabled="unenrollingUserId === q.userId"
                    class="rounded border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    @click="handleManagerUnenroll(q.userId)"
                  >
                    {{ unenrollingUserId === q.userId ? '...' : 'Disiscrivi dalla coda' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Delete Schedule Confirmation Dialog -->
    <ConfirmDialog
      :open="showDeleteDialog"
      title="Annulla / Elimina lezione"
      description="Sei sicuro di voler annullare questa lezione? Lo stato passerà ad Annullata dal gerente."
      confirm-label="Elimina lezione"
      variant="danger"
      :loading="deleting"
      :show-notify-option="shouldPromptNotifyOnDelete"
      notify-label="Invia email di avviso annullamento a tutti gli iscritti della lezione"
      :default-notify="true"
      :show-optional-message="shouldPromptNotifyOnDelete"
      @close="showDeleteDialog = false"
      @confirm="handleConfirmDelete"
    />

    <!-- Send Email to Enrolled Users Modal -->
    <Teleport to="body">
      <div
        v-if="showEmailModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        @click.self="!sendingEmail && (showEmailModal = false)"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
          <h3 class="text-lg font-bold text-slate-900">
            Invia email agli iscritti della lezione
          </h3>
          <p class="mt-1 text-xs text-slate-600">
            Il messaggio verrà inviato a tutti gli iscritti effettivi della lezione ({{ enrolledUsers?.length ?? 0 }} destinatari).
          </p>

          <div
            v-if="emailError"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ emailError }}
          </div>

          <div class="mt-4">
            <label class="block text-xs font-semibold text-slate-700 mb-1">
              Messaggio <span class="text-red-600">*</span>
            </label>
            <textarea
              v-model="emailMessage"
              rows="4"
              maxlength="2000"
              placeholder="Scrivi il messaggio per gli iscritti alla lezione..."
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              :disabled="sendingEmail"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              @click="showEmailModal = false"
            >
              Annulla
            </button>
            <button
              type="button"
              :disabled="sendingEmail"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              @click="handleSendParticipantsEmail"
            >
              {{ sendingEmail ? 'Invio in corso...' : 'Invia email' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

