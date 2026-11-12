<script setup lang="ts">
import { computed, ref } from 'vue'
import { CLASS_COLORS } from '../../../../shared/schemas/common'
import { formatCenterDate } from '../../../../shared/utils/timezone'
import type { ClassRecord } from '~/components/worker/ClassForm.vue'
import { CLASS_COLOR_STYLES, extractApiErrorMessage } from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite, centerTimezone } = useAuth()

const search = ref('')
const colorFilter = ref('')
const sortBy = ref<'name' | 'color' | 'createdAt'>('name')
const sortOrder = ref<'asc' | 'desc'>('asc')

const errorMessage = ref('')
const deletingTarget = ref<ClassRecord | null>(null)
const deletingLoading = ref(false)

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, refresh } = await useAsyncData(
  'worker-classes-list',
  () =>
    $fetch<{ classes: ClassRecord[] }>('/api/classes', {
      headers,
      query: {
        search: search.value || undefined,
        color: colorFilter.value || undefined,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      },
    }),
  {
    watch: [search, colorFilter, sortBy, sortOrder],
  },
)

const classesList = computed(() => data.value?.classes ?? [])

function toggleSort(column: 'name' | 'color' | 'createdAt') {
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
    await $fetch(`/api/classes/${deletingTarget.value.id}`, {
      method: 'DELETE',
    })
    deletingTarget.value = null
    await refresh()
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile eliminare il corso.',
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
        <h1 class="text-2xl font-bold text-slate-900">Corsi</h1>
        <p class="mt-1 text-sm text-slate-600">
          Elenco dei corsi di gruppo della sede attiva.
        </p>
      </div>

      <!-- SPECIFICATION.md line 392: "Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare" -->
      <NuxtLink
        v-if="canWrite"
        to="/worker/classes/new"
        data-testid="create-class-btn"
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
      >
        <span>+ Crea corso</span>
      </NuxtLink>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <!-- Filters & Column Sorting -->
    <div class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:grid-cols-3">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Cerca per nome o descrizione</label>
        <input
          v-model="search"
          type="search"
          placeholder="Filtra corsi..."
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Filtra per colore</label>
        <select
          v-model="colorFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Tutti i colori</option>
          <option v-for="c in CLASS_COLORS" :key="c" :value="c">
            {{ CLASS_COLOR_STYLES[c].label }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Ordina per</label>
        <div class="flex gap-2">
          <select
            v-model="sortBy"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="name">Nome</option>
            <option value="color">Colore</option>
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
        Caricamento corsi...
      </div>

      <div v-else-if="classesList.length === 0" class="p-8 text-center text-sm text-slate-500">
        Nessun corso trovato.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('name')">
                Nome {{ sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('color')">
                Colore {{ sortBy === 'color' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3">Descrizione</th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('createdAt')">
                Creato il {{ sortBy === 'createdAt' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr
              v-for="item in classesList"
              :key="item.id"
              class="hover:bg-slate-50/80"
            >
              <td class="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                <NuxtLink :to="`/worker/classes/${item.id}`" class="hover:text-indigo-600">
                  {{ item.name }}
                </NuxtLink>
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                <ClassColorBadge :color="item.color" />
              </td>
              <td class="max-w-md truncate px-4 py-3 text-slate-600">
                {{ item.description || '—' }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-500">
                {{ formatCenterDate(item.createdAt, centerTimezone) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <div v-if="canWrite" class="inline-flex items-center gap-2">
                  <NuxtLink
                    :to="`/worker/classes/${item.id}`"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Modifica
                  </NuxtLink>
                  <button
                    type="button"
                    class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    @click="deletingTarget = item"
                  >
                    Elimina
                  </button>
                </div>
                <NuxtLink
                  v-else
                  :to="`/worker/classes/${item.id}`"
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
      title="Elimina corso"
      :description="`Sei sicuro di voler eliminare il corso «${deletingTarget?.name ?? ''}»? L'operazione verrà bloccata se esistono lezioni attive o programmate.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deletingLoading"
      @close="deletingTarget = null"
      @confirm="handleDeleteConfirm"
    />
  </div>
</template>

