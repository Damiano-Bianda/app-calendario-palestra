<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { formatCenterDate } from '../../../shared/utils/timezone'
import type { CustomerScheduleItem } from '~/components/customer/UserCourseCard.vue'
import { extractApiErrorMessage, getClassColorStyle } from '~/utils/ui-formatters'

definePageMeta({
  layout: 'customer',
  middleware: 'customer',
})

interface CustomerSummarySubscriptionItem {
  id: string
  subscriptionId: string
  centerId: string
  userId: string
  startDate: string
  endDate: string | null
  entrances: number | null
  usedEntrances: number
  remainingEntrances: number | null
  isActive: boolean
  subscription: {
    id: string
    name: string
    description: string | null
    entrances: number | null
    durationDays: number | null
  }
  classes: Array<{
    id: string
    name: string
    color: string
  }>
}

interface CustomerSummaryResponse {
  activeSchedules: CustomerScheduleItem[]
  cancelledSchedules: CustomerScheduleItem[]
  activeSubscriptions: CustomerSummarySubscriptionItem[]
  expiredSubscriptions: CustomerSummarySubscriptionItem[]
}

const { activeCenter, centerTimezone } = useAuth()

const loading = ref(false)
const errorMessage = ref('')
const activeSchedules = ref<CustomerScheduleItem[]>([])
const cancelledSchedules = ref<CustomerScheduleItem[]>([])
const activeSubscriptions = ref<CustomerSummarySubscriptionItem[]>([])
const expiredSubscriptions = ref<CustomerSummarySubscriptionItem[]>([])

async function loadSummary() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await $fetch<CustomerSummaryResponse>('/api/customer/summary')
    activeSchedules.value = res.activeSchedules
    cancelledSchedules.value = res.cancelledSchedules
    activeSubscriptions.value = res.activeSubscriptions
    expiredSubscriptions.value = res.expiredSubscriptions
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile caricare il riepilogo del cliente.',
    )
  } finally {
    loading.value = false
  }
}

function formatDateInCenter(utcIso: string | null): string {
  if (!utcIso) return 'Illimitata'
  try {
    return formatCenterDate(utcIso, centerTimezone.value)
  } catch {
    return utcIso
  }
}

function formatEntrancesSummary(sub: CustomerSummarySubscriptionItem): string {
  if (sub.entrances === null || sub.remainingEntrances === null) {
    return `Entrate illimitate (${sub.usedEntrances} utilizzate)`
  }
  return `${sub.remainingEntrances} rimanenti su ${sub.entrances}`
}

watch(
  () => activeCenter.value?.centerId,
  () => {
    loadSummary()
  },
)

onMounted(() => {
  loadSummary()
})
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">
          Riepilogo
        </h1>
        <p class="mt-0.5 text-xs text-slate-500">
          Lezioni prenotate, avvisi di annullamento e stato delle tue sottoscrizioni presso
          <strong class="font-semibold text-slate-700">{{ activeCenter?.centerName ?? 'la sede' }}</strong>.
        </p>
      </div>

      <button
        type="button"
        class="self-start rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 sm:self-auto"
        @click="loadSummary"
      >
        Aggiorna
      </button>
    </div>

    <div
      v-if="errorMessage"
      role="alert"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="loading"
      class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500"
    >
      Caricamento riepilogo in corso...
    </div>

    <template v-else>
      <!-- SECTION 1: Corsi con iscrizione attiva (ENROLLING, UPCOMING, ACTIVE) -->
      <section data-testid="summary-active-schedules" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-900">
            Lezioni con iscrizione attiva
          </h2>
          <span class="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
            {{ activeSchedules.length }}
          </span>
        </div>

        <div
          v-if="activeSchedules.length === 0"
          class="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"
        >
          Non hai iscrizioni attive o in coda al momento.
        </div>

        <div v-else class="space-y-3">
          <CustomerUserCourseCard
            v-for="item in activeSchedules"
            :key="item.id"
            :schedule="item"
            :timezone="centerTimezone"
            :readonly="true"
            :show-date="true"
          />
        </div>
      </section>

      <!-- SECTION 2: Corsi annullati per posti o da (vice) gerente fino a data e ora di fine -->
      <section data-testid="summary-cancelled-schedules" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-900">
            Lezioni annullate
          </h2>
          <span class="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
            {{ cancelledSchedules.length }}
          </span>
        </div>

        <div
          v-if="cancelledSchedules.length === 0"
          class="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"
        >
          Nessuna lezione a cui eri iscritto risulta annullata.
        </div>

        <div v-else class="space-y-3">
          <CustomerUserCourseCard
            v-for="item in cancelledSchedules"
            :key="item.id"
            :schedule="item"
            :timezone="centerTimezone"
            :readonly="true"
            :show-date="true"
          />
        </div>
      </section>

      <!-- SECTION 3: Lista sottoscrizioni attive -->
      <section data-testid="summary-active-subscriptions" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-900">
            Sottoscrizioni attive
          </h2>
          <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            {{ activeSubscriptions.length }}
          </span>
        </div>

        <div
          v-if="activeSubscriptions.length === 0"
          class="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"
        >
          Non hai sottoscrizioni d’abbonamento attive in questa sede.
        </div>

        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <article
            v-for="sub in activeSubscriptions"
            :key="sub.id"
            class="rounded-xl border border-emerald-200 bg-white p-4 shadow-2xs"
          >
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-base font-bold text-slate-900">
                {{ sub.subscription.name }}
              </h3>
              <span class="shrink-0 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Attiva
              </span>
            </div>

            <p v-if="sub.subscription.description" class="mt-1 text-xs text-slate-500">
              {{ sub.subscription.description }}
            </p>

            <div class="mt-3 space-y-1.5 text-xs text-slate-600">
              <div class="flex justify-between">
                <span>Validità:</span>
                <strong class="text-slate-900">
                  {{ formatDateInCenter(sub.startDate) }} → {{ formatDateInCenter(sub.endDate) }}
                </strong>
              </div>
              <div class="flex justify-between">
                <span>Entrate:</span>
                <strong class="text-emerald-700">
                  {{ formatEntrancesSummary(sub) }}
                </strong>
              </div>
            </div>

            <div v-if="sub.classes.length > 0" class="mt-3 border-t border-slate-100 pt-2.5">
              <p class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Corsi inclusi
              </p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="cls in sub.classes"
                  :key="cls.id"
                  class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
                >
                  <span
                    class="h-2 w-2 rounded-full border"
                    :class="getClassColorStyle(cls.color).swatchClass"
                  />
                  {{ cls.name }}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- SECTION 4: Lista sottoscrizioni scadute -->
      <section data-testid="summary-expired-subscriptions" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-900">
            Sottoscrizioni scadute
          </h2>
          <span class="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {{ expiredSubscriptions.length }}
          </span>
        </div>

        <div
          v-if="expiredSubscriptions.length === 0"
          class="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"
        >
          Nessuna sottoscrizione scaduta o esaurita.
        </div>

        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <article
            v-for="sub in expiredSubscriptions"
            :key="sub.id"
            class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 opacity-85"
          >
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-base font-bold text-slate-700">
                {{ sub.subscription.name }}
              </h3>
              <span class="shrink-0 rounded-full border border-slate-300 bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                Scaduta / Esaurita
              </span>
            </div>

            <div class="mt-3 space-y-1.5 text-xs text-slate-600">
              <div class="flex justify-between">
                <span>Periodo:</span>
                <strong class="text-slate-800">
                  {{ formatDateInCenter(sub.startDate) }} → {{ formatDateInCenter(sub.endDate) }}
                </strong>
              </div>
              <div class="flex justify-between">
                <span>Entrate:</span>
                <strong class="text-slate-800">
                  {{ formatEntrancesSummary(sub) }}
                </strong>
              </div>
            </div>

            <div v-if="sub.classes.length > 0" class="mt-3 border-t border-slate-200/70 pt-2.5">
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="cls in sub.classes"
                  :key="cls.id"
                  class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
                >
                  <span
                    class="h-2 w-2 rounded-full border"
                    :class="getClassColorStyle(cls.color).swatchClass"
                  />
                  {{ cls.name }}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

