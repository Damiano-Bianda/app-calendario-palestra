<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatCenterDate } from '../../../../shared/utils/timezone'
import type { SubscriptionRecord } from '~/components/worker/SubscriptionForm.vue'
import { extractApiErrorMessage } from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite, centerTimezone } = useAuth()

const search = ref('')
const sortBy = ref<'name' | 'entrances' | 'durationDays' | 'createdAt'>('name')
const sortOrder = ref<'asc' | 'desc'>('asc')

const errorMessage = ref('')
const deletingTarget = ref<SubscriptionRecord | null>(null)
const deletingLoading = ref(false)

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, refresh } = await useAsyncData(
  'worker-subscriptions-list',
  () =>
    $fetch<{ subscriptions: SubscriptionRecord[] }>('/api/subscriptions', {
      headers,
      query: {
        search: search.value || undefined,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      },
    }),
  {
    watch: [search, sortBy, sortOrder],
  },
)

const subscriptionsList = computed(() => data.value?.subscriptions ?? [])

function toggleSort(column: 'name' | 'entrances' | 'durationDays' | 'createdAt') {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortOrder.value = 'asc'
  }
}

async function handleDeleteConfirm() {
  if (!deletingTarget.value || !canWrite.value) return
  deletingLoading.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/subscriptions/${deletingTarget.value.id}`, {
      method: 'DELETE',
    })
    deletingTarget.value = null
    await refresh()
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      "Impossibile eliminare l'abbonamento.",
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
        <h1 class="text-2xl font-bold text-slate-900">Abbonamenti</h1>
        <p class="mt-1 text-sm text-slate-600">
          Template di abbonamento della sede attiva.
        </p>
      </div>

      <!-- SPECIFICATION.md line 396: "Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare" -->
      <NuxtLink
        v-if="canWrite"
        to="/worker/subscriptions/new"
        data-testid="create-subscription-btn"
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
      >
        + Crea abbonamento
      </NuxtLink>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <!-- Filters & Sorting -->
    <div class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:grid-cols-2">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">
          Cerca per nome, descrizione o corso associato
        </label>
        <input
          v-model="search"
          type="search"
          placeholder="Filtra abbonamenti..."
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Ordina per</label>
        <div class="flex gap-2">
          <select
            v-model="sortBy"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="name">Nome</option>
            <option value="entrances">Numero entrate</option>
            <option value="durationDays">Durata in giorni</option>
            <option value="createdAt">Data creazione</option>
          </select>
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
          >
            {{ sortOrder === 'asc' ? '↑ ASC' : '↓ DESC' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div v-if="pending" class="p-8 text-center text-sm text-slate-500">
        Caricamento abbonamenti...
      </div>

      <div v-else-if="subscriptionsList.length === 0" class="p-8 text-center text-sm text-slate-500">
        Nessun abbonamento trovato.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('name')">
                Nome {{ sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('entrances')">
                Entrate {{ sortBy === 'entrances' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('durationDays')">
                Durata {{ sortBy === 'durationDays' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3">Corsi associati</th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('createdAt')">
                Creato il {{ sortBy === 'createdAt' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr v-for="sub in subscriptionsList" :key="sub.id" class="hover:bg-slate-50/80">
              <td class="whitespace-nowrap px-4 py-3">
                <NuxtLink
                  :to="`/worker/subscriptions/${sub.id}`"
                  class="font-semibold text-slate-900 hover:text-indigo-600"
                >
                  {{ sub.name }}
                </NuxtLink>
                <p v-if="sub.description" class="max-w-xs truncate text-xs text-slate-500">
                  {{ sub.description }}
                </p>
              </td>

              <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-700">
                {{ sub.entrances !== null ? `${sub.entrances} entrate` : 'Illimitate' }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-700">
                {{ sub.durationDays !== null ? `${sub.durationDays} giorni` : 'Illimitata' }}
              </td>

              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="cls in sub.classes"
                    :key="cls.id"
                    class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
                  >
                    <ClassColorBadge :color="cls.color" :show-label="false" />
                    <span>{{ cls.name }}</span>
                  </span>
                </div>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-500">
                {{ formatCenterDate(sub.createdAt, centerTimezone) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right">
                <div v-if="canWrite" class="inline-flex items-center gap-2">
                  <NuxtLink
                    :to="`/worker/subscriptions/${sub.id}`"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Modifica
                  </NuxtLink>
                  <button
                    type="button"
                    class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    @click="deletingTarget = sub"
                  >
                    Elimina
                  </button>
                </div>
                <NuxtLink
                  v-else
                  :to="`/worker/subscriptions/${sub.id}`"
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
      title="Elimina abbonamento"
      :description="`Sei sicuro di voler eliminare l'abbonamento «${deletingTarget?.name ?? ''}»? L'operazione verrà interrotta se ci sono utenti con questo abbonamento attivo.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deletingLoading"
      @close="deletingTarget = null"
      @confirm="handleDeleteConfirm"
    />
  </div>
</template>

