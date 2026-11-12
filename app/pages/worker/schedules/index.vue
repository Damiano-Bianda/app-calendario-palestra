<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EnrichedScheduleResponse } from '../../../../server/utils/domain-queries'
import {
  DELETABLE_SCHEDULE_STATUSES,
  EDITABLE_SCHEDULE_STATUSES,
  SCHEDULE_STATUSES,
  type ScheduleStatus,
} from '../../../../shared/utils/schedule-status'
import {
  formatCenterDate,
  formatCenterTimeRange,
} from '../../../../shared/utils/timezone'
import type { SimpleClassOption } from '~/components/worker/ScheduleForm.vue'
import {
  extractApiErrorMessage,
  SCHEDULE_STATUS_STYLES,
} from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite, centerTimezone } = useAuth()

const fromDate = ref('')
const toDate = ref('')
const classFilter = ref('')
const statusFilter = ref('')
const sortOrder = ref<'asc' | 'desc'>('asc')

const errorMessage = ref('')
const deletingTarget = ref<EnrichedScheduleResponse | null>(null)
const deletingLoading = ref(false)

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: classesData } = await useAsyncData('worker-schedules-classes-filter', () =>
  $fetch<{ classes: SimpleClassOption[] }>('/api/classes', { headers }),
)

const { data, pending, refresh } = await useAsyncData(
  'worker-schedules-list',
  () =>
    $fetch<{ schedules: EnrichedScheduleResponse[] }>('/api/schedules', {
      headers,
      query: {
        from: fromDate.value || undefined,
        to: toDate.value || undefined,
        classId: classFilter.value || undefined,
        status: statusFilter.value || undefined,
        sortOrder: sortOrder.value,
      },
    }),
  {
    watch: [fromDate, toDate, classFilter, statusFilter, sortOrder],
  },
)

const schedulesList = computed(() => data.value?.schedules ?? [])
const classesList = computed(() => classesData.value?.classes ?? [])

function canDeleteRow(item: EnrichedScheduleResponse): boolean {
  return canWrite.value && DELETABLE_SCHEDULE_STATUSES.includes(item.status)
}

function canEditRow(item: EnrichedScheduleResponse): boolean {
  return canWrite.value && EDITABLE_SCHEDULE_STATUSES.includes(item.status)
}

function shouldPromptNotify(item: EnrichedScheduleResponse | null): boolean {
  if (!item) return false
  return (
    (item.status === 'PUBLISHED' ||
      item.status === 'ENROLLING' ||
      item.status === 'UPCOMING') &&
    item.enrolledCount > 0
  )
}

async function handleDeleteConfirm(payload: {
  notifyEnrolled: boolean
  notificationMessage: string | null
}) {
  if (!deletingTarget.value || !canWrite.value) return
  deletingLoading.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/schedules/${deletingTarget.value.id}`, {
      method: 'DELETE',
      body: {
        notifyEnrolled: payload.notifyEnrolled,
        notificationMessage: payload.notificationMessage,
      },
    })
    deletingTarget.value = null
    await refresh()
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile eliminare la lezione.',
    )
    deletingTarget.value = null
  } finally {
    deletingLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Lezioni</h1>
        <p class="mt-1 text-sm text-slate-600">
          Elenco completo delle lezioni programmate nella sede ({{ centerTimezone }}).
        </p>
      </div>

      <!-- SPECIFICATION.md line 400: "Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare" -->
      <NuxtLink
        v-if="canWrite"
        to="/worker/schedules/new"
        data-testid="create-schedule-btn"
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
      >
        + Crea lezione
      </NuxtLink>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <!-- Filters -->
    <div class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:grid-cols-5">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Da data</label>
        <input
          v-model="fromDate"
          type="date"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">A data</label>
        <input
          v-model="toDate"
          type="date"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Corso</label>
        <select
          v-model="classFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Tutti i corsi</option>
          <option v-for="cls in classesList" :key="cls.id" :value="cls.id">
            {{ cls.name }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Stato</label>
        <select
          v-model="statusFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Tutti gli stati</option>
          <option v-for="st in SCHEDULE_STATUSES" :key="st" :value="st">
            {{ SCHEDULE_STATUS_STYLES[st as ScheduleStatus].label }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Ordine data</label>
        <button
          type="button"
          class="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
        >
          {{ sortOrder === 'asc' ? '↑ Cronologico (ASC)' : '↓ Più recenti (DESC)' }}
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div v-if="pending" class="p-8 text-center text-sm text-slate-500">
        Caricamento lezioni...
      </div>

      <div v-else-if="schedulesList.length === 0" class="p-8 text-center text-sm text-slate-500">
        Nessuna lezione trovata con i filtri selezionati.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th class="px-4 py-3">Data e Orario</th>
              <th class="px-4 py-3">Corso</th>
              <th class="px-4 py-3">Istruttore</th>
              <th class="px-4 py-3">Iscritti / Posti</th>
              <th class="px-4 py-3">Stato</th>
              <th class="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr v-for="item in schedulesList" :key="item.id" class="hover:bg-slate-50/80">
              <td class="whitespace-nowrap px-4 py-3">
                <div class="font-semibold text-slate-900">
                  {{ formatCenterDate(item.startDate, centerTimezone) }}
                </div>
                <div class="text-xs text-slate-500">
                  {{ formatCenterTimeRange(item.startDate, item.durationMinutes, centerTimezone) }}
                  ({{ item.durationMinutes }} min)
                </div>
              </td>

              <td class="whitespace-nowrap px-4 py-3">
                <div class="flex items-center gap-2">
                  <ClassColorBadge :color="item.class?.color" :show-label="false" />
                  <span class="font-semibold text-slate-900">
                    {{ item.class?.name ?? 'Corso' }}
                  </span>
                </div>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                {{
                  item.instructor
                    ? `${item.instructor.name} ${item.instructor.surname}`
                    : '—'
                }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                <span class="font-semibold">{{ item.enrolledCount }}</span>
                / {{ item.availableSpots ?? '∞' }}
                <span class="text-xs text-slate-500">(min {{ item.minimumSpots }})</span>
                <span
                  v-if="item.queuedCount > 0"
                  class="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800"
                >
                  +{{ item.queuedCount }} in coda
                </span>
              </td>

              <td class="whitespace-nowrap px-4 py-3">
                <ScheduleStatusBadge :status="item.status" />
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right">
                <div v-if="canWrite" class="inline-flex items-center gap-2">
                  <NuxtLink
                    :to="`/worker/schedules/${item.id}`"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {{ canEditRow(item) ? 'Modifica / Iscritti' : 'Dettaglio / Iscritti' }}
                  </NuxtLink>
                  <button
                    v-if="canDeleteRow(item)"
                    type="button"
                    class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    @click="deletingTarget = item"
                  >
                    Elimina
                  </button>
                </div>
                <NuxtLink
                  v-else
                  :to="`/worker/schedules/${item.id}`"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Visualizza
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(deletingTarget)"
      title="Elimina lezione"
      description="Confermi di voler annullare questa lezione?"
      confirm-label="Elimina"
      variant="danger"
      :loading="deletingLoading"
      :show-notify-option="shouldPromptNotify(deletingTarget)"
      notify-label="Invia email di avviso a tutti gli iscritti della lezione"
      :default-notify="true"
      :show-optional-message="shouldPromptNotify(deletingTarget)"
      @close="deletingTarget = null"
      @confirm="handleDeleteConfirm"
    />
  </div>
</template>

