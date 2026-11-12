<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  getCustomerScheduleStatusLabel,
  type ScheduleStatus,
} from '../../../shared/utils/schedule-status'
import {
  formatCenterDate,
  formatCenterTimeRange,
} from '../../../shared/utils/timezone'
import {
  formatCustomerSpotsLabel,
  getClassColorStyle,
  getCustomerStatusBadgeClass,
} from '~/utils/ui-formatters'

export interface CustomerScheduleItem {
  id: string
  classId: string
  centerId: string
  instructorId: string | null
  startDate: string
  endDate: string
  durationMinutes: number
  availableSpots: number | null
  minimumSpots: number
  status: ScheduleStatus
  enrolledCount: number
  remainingSpots: number | null
  queuedCount: number
  customerStatusLabel?: string
  class: {
    id: string
    name: string
    description: string | null
    color: string
  } | null
  instructor: {
    id: string
    name: string
    surname: string
    email?: string
    phoneNumber?: string
  } | null
  requiredSubscriptions: Array<{
    id: string
    name: string
    description: string | null
    entrances: number | null
    durationDays: number | null
  }>
  userEnrollment: {
    isEnrolled: boolean
    isQueued: boolean
    queuePosition: number | null
    userScheduleId: string | null
    userSubscriptionId: string | null
  }
}

const props = withDefaults(
  defineProps<{
    schedule: CustomerScheduleItem
    timezone: string
    readonly?: boolean
    showDate?: boolean
    loading?: boolean
  }>(),
  {
    readonly: false,
    showDate: false,
    loading: false,
  },
)

const emit = defineEmits<{
  (e: 'enroll', scheduleId: string): void
  (e: 'unenroll', scheduleId: string): void
}>()

const showSubscriptionsModal = ref(false)

const colorStyle = computed(() => getClassColorStyle(props.schedule.class?.color))

const formattedDatePrefix = computed(() => {
  if (!props.showDate) return ''
  try {
    return `${formatCenterDate(props.schedule.startDate, props.timezone)} • `
  } catch {
    return ''
  }
})

const formattedTimeAndDuration = computed(() => {
  try {
    const timeRange = formatCenterTimeRange(
      props.schedule.startDate,
      props.schedule.durationMinutes,
      props.timezone,
    )
    return `${formattedDatePrefix.value}${timeRange} (${props.schedule.durationMinutes} min)`
  } catch {
    return `${props.schedule.durationMinutes} min`
  }
})

const spotsLabel = computed(() =>
  formatCustomerSpotsLabel(props.schedule.availableSpots, props.schedule.remainingSpots),
)

const isFull = computed(
  () =>
    props.schedule.availableSpots !== null &&
    props.schedule.remainingSpots !== null &&
    props.schedule.remainingSpots <= 0,
)

const statusLabel = computed(
  () =>
    props.schedule.customerStatusLabel ||
    getCustomerScheduleStatusLabel(props.schedule.status, props.schedule.userEnrollment),
)

const statusBadgeClass = computed(() =>
  getCustomerStatusBadgeClass(props.schedule.status, props.schedule.userEnrollment),
)

const instructorFullName = computed(() => {
  const instr = props.schedule.instructor
  if (!instr) return 'Istruttore non assegnato'
  return `${instr.name} ${instr.surname}`.trim()
})

const isEnrolledOrQueued = computed(
  () => props.schedule.userEnrollment.isEnrolled || props.schedule.userEnrollment.isQueued,
)

const canInteractWithEnrollment = computed(
  () => !props.readonly && props.schedule.status === 'ENROLLING',
)

function handleActionClick() {
  if (!canInteractWithEnrollment.value || props.loading) return
  if (isEnrolledOrQueued.value) {
    emit('unenroll', props.schedule.id)
  } else {
    emit('enroll', props.schedule.id)
  }
}
</script>

<template>
  <article
    class="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:border-slate-300"
    :data-testid="`user-course-card-${schedule.id}`"
  >
    <div class="space-y-2.5">
      <!-- ROW 1: Left: time & duration | Right: X posti liberi su Y or Completo (SPECIFICATION.md line 390) -->
      <div
        data-testid="course-card-row-1"
        class="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-600 sm:text-sm"
      >
        <div class="flex items-center gap-1.5 font-semibold text-slate-800">
          <span>{{ formattedTimeAndDuration }}</span>
        </div>

        <div
          class="text-right font-semibold"
          :class="isFull ? 'text-amber-700' : 'text-slate-600'"
        >
          {{ spotsLabel }}
        </div>
      </div>

      <!-- ROW 2: Left: course name | Right: status label (SPECIFICATION.md line 390) -->
      <div
        data-testid="course-card-row-2"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="h-3.5 w-3.5 shrink-0 rounded-full border"
            :class="colorStyle.swatchClass"
            :title="`Colore corso: ${colorStyle.label}`"
          />
          <h3 class="truncate text-base font-bold text-slate-900">
            {{ schedule.class?.name ?? 'Corso' }}
          </h3>
        </div>

        <div class="flex items-center gap-1.5">
          <span
            data-testid="course-card-status-label"
            class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
            :class="statusBadgeClass"
          >
            {{ statusLabel }}
            <template
              v-if="
                schedule.status === 'ENROLLING' &&
                schedule.userEnrollment.isQueued &&
                schedule.userEnrollment.queuePosition
              "
            >
              (#{{ schedule.userEnrollment.queuePosition }})
            </template>
          </span>
        </div>
      </div>

      <!-- ROW 3: Left: instructor name (SPECIFICATION.md line 390) -->
      <div
        data-testid="course-card-row-3"
        class="flex items-center justify-start text-sm text-slate-600"
      >
        <span>Istruttore: <strong class="font-medium text-slate-800">{{ instructorFullName }}</strong></span>
      </div>

      <!-- ROW 4: Left: popup trigger showing required subscriptions | Right: Iscriviti / Disiscriviti button (SPECIFICATION.md line 390) -->
      <div
        data-testid="course-card-row-4"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5"
      >
        <button
          type="button"
          data-testid="course-card-subscriptions-btn"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
          @click="showSubscriptionsModal = true"
        >
          <span>Abbonamenti necessari</span>
          <span class="rounded-full bg-slate-200 px-1.5 py-0.2 text-[11px] font-semibold text-slate-700">
            {{ schedule.requiredSubscriptions.length }}
          </span>
        </button>

        <div v-if="!readonly" class="flex items-center">
          <button
            v-if="canInteractWithEnrollment"
            type="button"
            data-testid="course-card-action-btn"
            :disabled="loading"
            class="inline-flex items-center justify-center rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow-2xs transition disabled:opacity-50 sm:text-sm"
            :class="
              isEnrolledOrQueued
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            "
            @click="handleActionClick"
          >
            <template v-if="loading">
              Attendere...
            </template>
            <template v-else>
              {{ isEnrolledOrQueued ? 'Disiscriviti' : 'Iscriviti' }}
            </template>
          </button>
        </div>
      </div>
    </div>

    <!-- Popup Modal for Required Subscriptions (Row 4 left trigger) -->
    <Teleport to="body">
      <div
        v-if="showSubscriptionsModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`req-subs-title-${schedule.id}`"
        @click.self="showSubscriptionsModal = false"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h4
                :id="`req-subs-title-${schedule.id}`"
                class="text-base font-bold text-slate-900"
              >
                Abbonamenti necessari
              </h4>
              <p class="mt-0.5 text-xs text-slate-500">
                Corso: <span class="font-medium text-slate-700">{{ schedule.class?.name ?? 'Corso' }}</span>
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Chiudi"
              @click="showSubscriptionsModal = false"
            >
              ✕
            </button>
          </div>

          <div class="mt-4 max-h-72 space-y-2.5 overflow-y-auto">
            <p
              v-if="schedule.requiredSubscriptions.length === 0"
              class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
            >
              Nessun abbonamento attualmente configurato per questo corso. Contatta la segreteria della sede.
            </p>

            <div
              v-for="sub in schedule.requiredSubscriptions"
              :key="sub.id"
              class="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <p class="text-sm font-semibold text-slate-900">
                {{ sub.name }}
              </p>
              <div class="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                <span class="rounded bg-white px-2 py-0.5 border border-slate-200">
                  {{ sub.entrances === null ? 'Entrate illimitate' : `${sub.entrances} entrate` }}
                </span>
                <span class="rounded bg-white px-2 py-0.5 border border-slate-200">
                  {{ sub.durationDays === null ? 'Durata illimitata' : `Durata: ${sub.durationDays} giorni` }}
                </span>
              </div>
              <p v-if="sub.description" class="mt-1.5 text-xs text-slate-500">
                {{ sub.description }}
              </p>
            </div>
          </div>

          <div class="mt-5 flex justify-end">
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              @click="showSubscriptionsModal = false"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </article>
</template>

