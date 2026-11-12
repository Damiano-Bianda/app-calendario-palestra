<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createUserSubscriptionSchema,
  updateUserSubscriptionSchema,
} from '../../../../shared/schemas/subscriptions'
import {
  formatCenterDate,
  localDateTimeToUtcIso,
  utcIsoToLocalParts,
} from '../../../../shared/utils/timezone'
import type { SubscriptionRecord } from '~/components/worker/SubscriptionForm.vue'
import type { WorkerUserRecord } from '~/components/worker/UserForm.vue'
import {
  extractApiErrorMessage,
  getTodayInCenterTimezone,
} from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

interface UserSubscriptionRow {
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
  createdAt: string
  subscription: {
    id: string
    name: string
    description: string | null
    entrances: number | null
    durationDays: number | null
  }
  user: {
    id: string
    email: string
    name: string
    surname: string
    phoneNumber: string
  }
}

const route = useRoute()
const { canWrite, centerTimezone } = useAuth()

const targetUserId = computed(() =>
  typeof route.query.user === 'string' && route.query.user.trim().length > 0
    ? route.query.user.trim()
    : '',
)

const search = ref('')
const activeOnlyFilter = ref<'' | 'true' | 'false'>('')
const subscriptionFilter = ref('')

const errorMessage = ref('')
const successMessage = ref('')

const deletingTarget = ref<UserSubscriptionRow | null>(null)
const deletingLoading = ref(false)
const savingId = ref<string | null>(null)

// Editable drafts keyed by userSubscription.id for `/worker/user-subscriptions?user=userId`
const editDrafts = reactive<
  Record<
    string,
    {
      localEndDate: string
      entrances: string
      error: string
    }
  >
>({})

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const [{ data: userSubsData, pending, refresh }, { data: templatesData }, { data: usersData }] =
  await Promise.all([
    useAsyncData(
      'worker-user-subscriptions-list',
      () =>
        $fetch<{ userSubscriptions: UserSubscriptionRow[] }>('/api/user-subscriptions', {
          headers,
          query: {
            user: targetUserId.value || undefined,
            subscriptionId: subscriptionFilter.value || undefined,
            activeOnly: activeOnlyFilter.value || undefined,
          },
        }),
      {
        watch: [targetUserId, subscriptionFilter, activeOnlyFilter],
      },
    ),
    useAsyncData('worker-user-subscriptions-templates', () =>
      $fetch<{ subscriptions: SubscriptionRecord[] }>('/api/subscriptions', { headers }),
    ),
    useAsyncData('worker-user-subscriptions-users', () =>
      $fetch<{ users: WorkerUserRecord[] }>('/api/users', { headers }),
    ),
  ])

const allRows = computed(() => userSubsData.value?.userSubscriptions ?? [])
const templatesList = computed(() => templatesData.value?.subscriptions ?? [])
const usersList = computed(() => usersData.value?.users ?? [])

const targetUserInfo = computed(() => {
  if (!targetUserId.value) return null
  return usersList.value.find((u) => u.id === targetUserId.value) ?? allRows.value[0]?.user ?? null
})

// Sync editable drafts whenever rows or timezone change
watch(
  [allRows, centerTimezone],
  ([rows, tz]) => {
    for (const row of rows) {
      const localEnd = row.endDate ? utcIsoToLocalParts(row.endDate, tz).date : ''
      editDrafts[row.id] = {
        localEndDate: localEnd,
        entrances: row.entrances !== null ? String(row.entrances) : '',
        error: '',
      }
    }
  },
  { immediate: true },
)

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allRows.value
  return allRows.value.filter((r) => {
    const fullName = `${r.user.name} ${r.user.surname}`.toLowerCase()
    const revName = `${r.user.surname} ${r.user.name}`.toLowerCase()
    const subName = r.subscription.name.toLowerCase()
    const email = r.user.email.toLowerCase()
    return (
      fullName.includes(q) ||
      revName.includes(q) ||
      subName.includes(q) ||
      email.includes(q)
    )
  })
})

// Assign new subscription modal
const showAssignModal = ref(false)
const assignForm = reactive({
  userId: '',
  subscriptionId: '',
  localStartDate: getTodayInCenterTimezone(centerTimezone.value),
})
const assignError = ref('')
const assigning = ref(false)

function openAssignModal(preselectedUserId?: string) {
  assignError.value = ''
  assignForm.userId = preselectedUserId || targetUserId.value || (usersList.value[0]?.id ?? '')
  assignForm.subscriptionId = templatesList.value[0]?.id ?? ''
  assignForm.localStartDate = getTodayInCenterTimezone(centerTimezone.value)
  showAssignModal.value = true
}

async function handleAssignSubscription() {
  if (!canWrite.value) return
  assignError.value = ''

  let startDateIso: string
  try {
    startDateIso = localDateTimeToUtcIso(
      assignForm.localStartDate,
      '00:00',
      centerTimezone.value,
    )
  } catch (err) {
    assignError.value = err instanceof Error ? err.message : 'Data di inizio non valida.'
    return
  }

  const parsed = createUserSubscriptionSchema.safeParse({
    userId: assignForm.userId,
    subscriptionId: assignForm.subscriptionId,
    startDate: startDateIso,
  })
  if (!parsed.success) {
    assignError.value = parsed.error.issues[0]?.message ?? 'Parametri non validi.'
    return
  }

  assigning.value = true
  try {
    await $fetch('/api/user-subscriptions', {
      method: 'POST',
      body: parsed.data,
    })
    showAssignModal.value = false
    successMessage.value = "Sottoscrizione d'abbonamento assegnata con successo."
    await refresh()
  } catch (err) {
    assignError.value = extractApiErrorMessage(
      err,
      'Impossibile assegnare la sottoscrizione.',
    )
  } finally {
    assigning.value = false
  }
}

async function handleSaveUserSubscription(row: UserSubscriptionRow) {
  if (!canWrite.value) return
  const draft = editDrafts[row.id]
  if (!draft) return

  draft.error = ''
  errorMessage.value = ''
  successMessage.value = ''

  let newEndDateIso: string | null = null
  const trimmedEnd = draft.localEndDate.trim()
  if (trimmedEnd !== '') {
    try {
      // End of the selected day in center.timezone so lessons on that date remain covered
      const endSec = localDateTimeToUtcIso(trimmedEnd, '23:59:59', centerTimezone.value)
      newEndDateIso = endSec.replace(/\.000Z$/, '.999Z')
    } catch (err) {
      draft.error = err instanceof Error ? err.message : 'Data di fine non valida.'
      return
    }
  }

  const trimmedEntrances = String(draft.entrances ?? '').trim()
  const newEntrances =
    trimmedEntrances === '' ? null : Number.parseInt(trimmedEntrances, 10)

  if (newEntrances !== null && newEntrances < row.usedEntrances) {
    draft.error = `Il nuovo numero di entrate totali (${newEntrances}) non può essere inferiore alle entrate già utilizzate (${row.usedEntrances}).`
    return
  }

  const parsed = updateUserSubscriptionSchema.safeParse({
    startDate: row.startDate,
    endDate: newEndDateIso,
    entrances: newEntrances,
  })
  if (!parsed.success) {
    draft.error = parsed.error.issues[0]?.message ?? 'Dati non validi.'
    return
  }

  savingId.value = row.id
  try {
    await $fetch(`/api/user-subscriptions/${row.id}`, {
      method: 'PUT',
      body: {
        endDate: parsed.data.endDate,
        entrances: parsed.data.entrances,
      },
    })
    successMessage.value = `Sottoscrizione «${row.subscription.name}» aggiornata con successo.`
    await refresh()
  } catch (err) {
    draft.error = extractApiErrorMessage(
      err,
      'Impossibile salvare le modifiche alla sottoscrizione.',
    )
  } finally {
    savingId.value = null
  }
}

async function handleDeleteConfirm() {
  if (!deletingTarget.value || !canWrite.value) return
  deletingLoading.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/user-subscriptions/${deletingTarget.value.id}`, {
      method: 'DELETE',
    })
    deletingTarget.value = null
    successMessage.value = 'Sottoscrizione eliminata con successo.'
    await refresh()
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile eliminare la sottoscrizione.',
    )
    deletingTarget.value = null
  } finally {
    deletingLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Top Header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div v-if="targetUserId" class="mb-1 flex items-center gap-3 text-xs font-semibold text-indigo-600">
          <NuxtLink to="/worker/user-subscriptions" class="hover:text-indigo-800">
            ← Tutte le sottoscrizioni
          </NuxtLink>
          <span class="text-slate-300">|</span>
          <NuxtLink :to="`/worker/users/${targetUserId}`" class="hover:text-indigo-800">
            Scheda cliente
          </NuxtLink>
        </div>

        <h1 class="text-2xl font-bold text-slate-900">
          {{
            targetUserId
              ? `Gestione sottoscrizioni${targetUserInfo ? `: ${targetUserInfo.name} ${targetUserInfo.surname}` : ''}`
              : "Sottoscrizioni d'abbonamento"
          }}
        </h1>
        <p class="mt-1 text-sm text-slate-600">
          {{
            targetUserId
              ? "Visualizza e modifica la data di fine e le entrate totali delle sottoscrizioni dell'utente."
              : "Elenco di tutte le sottoscrizioni d'abbonamento assegnate ai clienti della sede."
          }}
        </p>
      </div>

      <!-- SPECIFICATION.md lines 401-402: "Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare" -->
      <button
        v-if="canWrite"
        type="button"
        data-testid="assign-subscription-btn"
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
        @click="openAssignModal(targetUserId || undefined)"
      >
        + Assegna sottoscrizione
      </button>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="successMessage"
      class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
    >
      {{ successMessage }}
    </div>

    <!-- =================================================================== -->
    <!-- MODE A: GESTIONE SOTTOSCRIZIONE (`/worker/user-subscriptions?user=`) -->
    <!-- SPECIFICATION.md line 402                                           -->
    <!-- =================================================================== -->
    <div v-if="targetUserId" class="space-y-4">
      <div v-if="pending" class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Caricamento sottoscrizioni del cliente...
      </div>

      <div
        v-else-if="allRows.length === 0"
        class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500"
      >
        Nessuna sottoscrizione trovata per questo cliente.
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="row in allRows"
          :key="row.id"
          class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
        >
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <div class="flex items-center gap-2.5">
                <h2 class="text-lg font-bold text-slate-900">
                  {{ row.subscription.name }}
                </h2>
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  :class="
                    row.isActive
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-700'
                  "
                >
                  {{ row.isActive ? 'Attiva' : 'Scaduta / Esaurita' }}
                </span>
              </div>
              <p class="mt-0.5 text-xs text-slate-500">
                Data inizio: <strong>{{ formatCenterDate(row.startDate, centerTimezone) }}</strong>
                · Entrate utilizzate: <strong>{{ row.usedEntrances }}</strong>
                · Entrate rimanenti:
                <strong>
                  {{
                    row.remainingEntrances !== null
                      ? `${row.remainingEntrances} su ${row.entrances}`
                      : 'Illimitate'
                  }}
                </strong>
              </p>
            </div>

            <button
              v-if="canWrite"
              type="button"
              class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              @click="deletingTarget = row"
            >
              Elimina sottoscrizione
            </button>
          </div>

          <div
            v-if="editDrafts[row.id]?.error"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ editDrafts[row.id]?.error }}
          </div>

          <!-- Editable Fields: Total Entrances & End Date (Read-only for Instructors) -->
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Data di fine ({{ centerTimezone }})
                <span class="font-normal text-slate-400">(vuoto = illimitata)</span>
              </label>
              <input
                v-if="editDrafts[row.id]"
                v-model="editDrafts[row.id]!.localEndDate"
                type="date"
                :disabled="!canWrite"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Entrate totali
                <span class="font-normal text-slate-400">(vuoto = illimitate, min {{ Math.max(1, row.usedEntrances) }})</span>
              </label>
              <input
                v-if="editDrafts[row.id]"
                v-model="editDrafts[row.id]!.entrances"
                type="number"
                :min="Math.max(1, row.usedEntrances)"
                step="1"
                :disabled="!canWrite"
                placeholder="Illimitate"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
              />
            </div>

            <div v-if="canWrite" class="flex justify-end sm:justify-start">
              <button
                type="button"
                :disabled="savingId === row.id"
                class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
                @click="handleSaveUserSubscription(row)"
              >
                {{ savingId === row.id ? 'Salvataggio...' : 'Salva modifiche' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- =================================================================== -->
    <!-- MODE B: LISTA SOTTOSCRIZIONI (`/worker/user-subscriptions`)         -->
    <!-- SPECIFICATION.md line 401                                           -->
    <!-- =================================================================== -->
    <div v-else class="space-y-4">
      <!-- Filters -->
      <div class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:grid-cols-3">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">
            Cerca per cliente o abbonamento
          </label>
          <input
            v-model="search"
            type="search"
            placeholder="Nome, cognome, email o abbonamento..."
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Abbonamento</label>
          <select
            v-model="subscriptionFilter"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Tutti gli abbonamenti</option>
            <option v-for="tpl in templatesList" :key="tpl.id" :value="tpl.id">
              {{ tpl.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Stato validità</label>
          <select
            v-model="activeOnlyFilter"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Tutte</option>
            <option value="true">Solo attive</option>
            <option value="false">Scadute / Esaurite</option>
          </select>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div v-if="pending" class="p-8 text-center text-sm text-slate-500">
          Caricamento sottoscrizioni...
        </div>

        <div v-else-if="filteredRows.length === 0" class="p-8 text-center text-sm text-slate-500">
          Nessuna sottoscrizione trovata.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <tr>
                <th class="px-4 py-3">Cliente</th>
                <th class="px-4 py-3">Abbonamento</th>
                <th class="px-4 py-3">Inizio / Fine</th>
                <th class="px-4 py-3">Entrate rimanenti</th>
                <th class="px-4 py-3">Stato</th>
                <th class="px-4 py-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 bg-white">
              <tr v-for="row in filteredRows" :key="row.id" class="hover:bg-slate-50/80">
                <td class="whitespace-nowrap px-4 py-3">
                  <NuxtLink
                    :to="`/worker/users/${row.user.id}`"
                    class="font-semibold text-slate-900 hover:text-indigo-600"
                  >
                    {{ row.user.surname }} {{ row.user.name }}
                  </NuxtLink>
                  <div class="text-xs text-slate-500">{{ row.user.email }}</div>
                </td>

                <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                  {{ row.subscription.name }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                  <div>{{ formatCenterDate(row.startDate, centerTimezone) }}</div>
                  <div class="text-xs text-slate-500">
                    Scadenza:
                    {{ row.endDate ? formatCenterDate(row.endDate, centerTimezone) : 'Illimitata' }}
                  </div>
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                  <span class="font-semibold">
                    {{
                      row.remainingEntrances !== null
                        ? `${row.remainingEntrances} / ${row.entrances}`
                        : 'Illimitate'
                    }}
                  </span>
                  <span class="ml-1 text-xs text-slate-400">({{ row.usedEntrances }} usate)</span>
                </td>

                <td class="whitespace-nowrap px-4 py-3">
                  <span
                    class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    :class="
                      row.isActive
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    "
                  >
                    {{ row.isActive ? 'Attiva' : 'Scaduta / Esaurita' }}
                  </span>
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right">
                  <div v-if="canWrite" class="inline-flex items-center gap-2">
                    <NuxtLink
                      :to="`/worker/user-subscriptions?user=${row.userId}`"
                      class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Modifica
                    </NuxtLink>
                    <button
                      type="button"
                      class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      @click="deletingTarget = row"
                    >
                      Elimina
                    </button>
                  </div>
                  <NuxtLink
                    v-else
                    :to="`/worker/user-subscriptions?user=${row.userId}`"
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
    </div>

    <ConfirmDialog
      :open="Boolean(deletingTarget)"
      title="Elimina sottoscrizione"
      :description="`Sei sicuro di voler eliminare la sottoscrizione «${deletingTarget?.subscription.name ?? ''}» di ${deletingTarget?.user.name ?? ''} ${deletingTarget?.user.surname ?? ''}? L'operazione verrà bloccata se esistono lezioni attive o in coda associate.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deletingLoading"
      @close="deletingTarget = null"
      @confirm="handleDeleteConfirm"
    />

    <!-- Assign Subscription Modal -->
    <Teleport to="body">
      <div
        v-if="showAssignModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        @click.self="!assigning && (showAssignModal = false)"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
          <h3 class="text-lg font-bold text-slate-900">
            Assegna sottoscrizione d'abbonamento
          </h3>

          <div
            v-if="assignError"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ assignError }}
          </div>

          <div class="mt-4 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Cliente <span class="text-red-600">*</span>
              </label>
              <select
                v-model="assignForm.userId"
                :disabled="Boolean(targetUserId)"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              >
                <option value="" disabled>Seleziona cliente...</option>
                <option v-for="u in usersList" :key="u.id" :value="u.id">
                  {{ u.surname }} {{ u.name }} ({{ u.email }})
                </option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Abbonamento <span class="text-red-600">*</span>
              </label>
              <select
                v-model="assignForm.subscriptionId"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="" disabled>Seleziona abbonamento...</option>
                <option v-for="tpl in templatesList" :key="tpl.id" :value="tpl.id">
                  {{ tpl.name }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Data d'inizio ({{ centerTimezone }}) <span class="text-red-600">*</span>
              </label>
              <input
                v-model="assignForm.localStartDate"
                type="date"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              :disabled="assigning"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              @click="showAssignModal = false"
            >
              Annulla
            </button>
            <button
              type="button"
              :disabled="assigning || !assignForm.userId || !assignForm.subscriptionId"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              @click="handleAssignSubscription"
            >
              {{ assigning ? 'Salvataggio...' : 'Salva sottoscrizione' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

