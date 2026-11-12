<script setup lang="ts">
import { computed, ref } from 'vue'
import { sendUsersEmailSchema } from '../../../../shared/schemas/users'
import { formatCenterDate } from '../../../../shared/utils/timezone'
import type { WorkerUserRecord } from '~/components/worker/UserForm.vue'
import { extractApiErrorMessage } from '~/utils/ui-formatters'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite, centerTimezone } = useAuth()

const search = ref('')
const roleFilter = ref('')
const sortBy = ref<'surname' | 'name' | 'email' | 'phoneNumber' | 'createdAt'>('surname')
const sortOrder = ref<'asc' | 'desc'>('asc')

const selectedUserIds = ref<string[]>([])
const errorMessage = ref('')
const successMessage = ref('')

const deletingTarget = ref<WorkerUserRecord | null>(null)
const deletingLoading = ref(false)

// Bulk email modal state
const showBulkEmailModal = ref(false)
const bulkEmailSubject = ref('')
const bulkEmailMessage = ref('')
const sendingBulkEmail = ref(false)
const bulkEmailError = ref('')

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, refresh } = await useAsyncData(
  'worker-users-list',
  () =>
    $fetch<{ users: WorkerUserRecord[] }>('/api/users', {
      headers,
      query: {
        search: search.value || undefined,
        role: roleFilter.value || undefined,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      },
    }),
  {
    watch: [search, roleFilter, sortBy, sortOrder],
  },
)

const usersList = computed(() => data.value?.users ?? [])

const allVisibleSelected = computed(
  () =>
    usersList.value.length > 0 &&
    usersList.value.every((u) => selectedUserIds.value.includes(u.id)),
)

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    selectedUserIds.value = []
  } else {
    selectedUserIds.value = usersList.value.map((u) => u.id)
  }
}

function toggleSelectUser(userId: string) {
  const idx = selectedUserIds.value.indexOf(userId)
  if (idx >= 0) {
    selectedUserIds.value.splice(idx, 1)
  } else {
    selectedUserIds.value.push(userId)
  }
}

function toggleSort(column: 'surname' | 'name' | 'email' | 'phoneNumber' | 'createdAt') {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortOrder.value = 'asc'
  }
}

function getUserRoleBadges(u: WorkerUserRecord): Array<{ label: string; class: string }> {
  const badges: Array<{ label: string; class: string }> = []
  if (u.isManager) {
    badges.push({ label: 'Gerente', class: 'bg-indigo-100 text-indigo-800 border-indigo-200' })
  }
  if (u.isAssistantManager) {
    badges.push({ label: 'Vice gerente', class: 'bg-sky-100 text-sky-800 border-sky-200' })
  }
  if (u.isInstructor) {
    badges.push({ label: 'Istruttore', class: 'bg-amber-100 text-amber-900 border-amber-200' })
  }
  if (badges.length === 0) {
    badges.push({ label: 'Cliente', class: 'bg-slate-100 text-slate-700 border-slate-200' })
  }
  return badges
}

async function handleDeleteConfirm() {
  if (!deletingTarget.value || !canWrite.value) return
  deletingLoading.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/users/${deletingTarget.value.id}`, {
      method: 'DELETE',
    })
    selectedUserIds.value = selectedUserIds.value.filter((id) => id !== deletingTarget.value?.id)
    deletingTarget.value = null
    await refresh()
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(
      err,
      "Impossibile eliminare l'utente dalla sede.",
    )
    deletingTarget.value = null
  } finally {
    deletingLoading.value = false
  }
}

async function handleSendBulkEmail() {
  if (!canWrite.value) return
  bulkEmailError.value = ''

  const parsed = sendUsersEmailSchema.safeParse({
    userIds: selectedUserIds.value,
    subject: bulkEmailSubject.value.trim() || undefined,
    message: bulkEmailMessage.value.trim(),
  })
  if (!parsed.success) {
    bulkEmailError.value = parsed.error.issues[0]?.message ?? 'Compila i campi obbligatori.'
    return
  }

  sendingBulkEmail.value = true
  try {
    const res = await $fetch<{ sentCount: number }>('/api/users/email', {
      method: 'POST',
      body: parsed.data,
    })
    showBulkEmailModal.value = false
    bulkEmailSubject.value = ''
    bulkEmailMessage.value = ''
    selectedUserIds.value = []
    successMessage.value = `Email inviata con successo a ${res.sentCount} destinatari.`
  } catch (err) {
    bulkEmailError.value = extractApiErrorMessage(
      err,
      "Impossibile inviare l'email ai clienti selezionati.",
    )
  } finally {
    sendingBulkEmail.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Clienti e Utenti</h1>
        <p class="mt-1 text-sm text-slate-600">
          Gestione degli iscritti e dei collaboratori della sede attiva.
        </p>
      </div>

      <!-- SPECIFICATION.md line 398: "Pulsante per creare utente e pulsante per inviare email ai clienti selezionati. Istruttori vedono in sola lettura" -->
      <div v-if="canWrite" class="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          data-testid="email-selected-users-btn"
          :disabled="selectedUserIds.length === 0"
          class="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          @click="showBulkEmailModal = true"
        >
          ✉ Invia email ai selezionati ({{ selectedUserIds.length }})
        </button>

        <NuxtLink
          to="/worker/users/new"
          data-testid="create-user-btn"
          class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700"
        >
          + Crea cliente
        </NuxtLink>
      </div>
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

    <!-- Filters & Sorting -->
    <div class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:grid-cols-3">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">
          Cerca per nome, cognome, email o telefono
        </label>
        <input
          v-model="search"
          type="search"
          placeholder="Cerca utente..."
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Filtra per ruolo</label>
        <select
          v-model="roleFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Tutti gli utenti</option>
          <option value="customer">Solo Clienti</option>
          <option value="instructor">Istruttori</option>
          <option value="assistant_manager">Vice gerenti</option>
          <option value="manager">Gerente</option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Ordina per</label>
        <div class="flex gap-2">
          <select
            v-model="sortBy"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="surname">Cognome</option>
            <option value="name">Nome</option>
            <option value="email">Email</option>
            <option value="phoneNumber">Telefono</option>
            <option value="createdAt">Data registrazione</option>
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
        Caricamento utenti...
      </div>

      <div v-else-if="usersList.length === 0" class="p-8 text-center text-sm text-slate-500">
        Nessun utente trovato.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th v-if="canWrite" class="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  aria-label="Seleziona tutti"
                  class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('surname')">
                Cognome e Nome {{ sortBy === 'surname' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('email')">
                Email {{ sortBy === 'email' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('phoneNumber')">
                Telefono {{ sortBy === 'phoneNumber' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3">Ruoli</th>
              <th class="cursor-pointer px-4 py-3 hover:text-slate-900" @click="toggleSort('createdAt')">
                Iscritto il {{ sortBy === 'createdAt' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white">
            <tr v-for="u in usersList" :key="u.id" class="hover:bg-slate-50/80">
              <td v-if="canWrite" class="px-4 py-3">
                <input
                  type="checkbox"
                  :checked="selectedUserIds.includes(u.id)"
                  :aria-label="`Seleziona ${u.name} ${u.surname}`"
                  class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  @change="toggleSelectUser(u.id)"
                />
              </td>

              <td class="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                <NuxtLink :to="`/worker/users/${u.id}`" class="hover:text-indigo-600">
                  {{ u.surname }} {{ u.name }}
                </NuxtLink>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                {{ u.email }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                {{ u.phoneNumber }}
              </td>

              <td class="whitespace-nowrap px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="badge in getUserRoleBadges(u)"
                    :key="badge.label"
                    class="rounded-full border px-2 py-0.5 text-xs font-medium"
                    :class="badge.class"
                  >
                    {{ badge.label }}
                  </span>
                </div>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-500">
                {{ formatCenterDate(u.createdAt, centerTimezone) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right">
                <div v-if="canWrite" class="inline-flex items-center gap-2">
                  <NuxtLink
                    :to="`/worker/users/${u.id}`"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Modifica
                  </NuxtLink>
                  <button
                    v-if="!u.isManager"
                    type="button"
                    class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    @click="deletingTarget = u"
                  >
                    Elimina
                  </button>
                </div>
                <NuxtLink
                  v-else
                  :to="`/worker/users/${u.id}`"
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
      title="Elimina utente dalla sede"
      :description="`Sei sicuro di voler eliminare «${deletingTarget?.name ?? ''} ${deletingTarget?.surname ?? ''}» dalla sede? L'operazione si interromperà se l'utente ha lezioni attive o sottoscrizioni attive.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deletingLoading"
      @close="deletingTarget = null"
      @confirm="handleDeleteConfirm"
    />

    <!-- Bulk Email Modal -->
    <Teleport to="body">
      <div
        v-if="showBulkEmailModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        @click.self="!sendingBulkEmail && (showBulkEmailModal = false)"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
          <h3 class="text-lg font-bold text-slate-900">
            Invia email ai clienti selezionati ({{ selectedUserIds.length }})
          </h3>

          <div
            v-if="bulkEmailError"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ bulkEmailError }}
          </div>

          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Oggetto <span class="font-normal text-slate-400">(facoltativo)</span>
              </label>
              <input
                v-model="bulkEmailSubject"
                type="text"
                maxlength="255"
                placeholder="Comunicazione dalla palestra"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Messaggio <span class="text-red-600">*</span>
              </label>
              <textarea
                v-model="bulkEmailMessage"
                rows="4"
                maxlength="2000"
                placeholder="Scrivi il messaggio per i clienti selezionati..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              :disabled="sendingBulkEmail"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              @click="showBulkEmailModal = false"
            >
              Annulla
            </button>
            <button
              type="button"
              :disabled="sendingBulkEmail"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              @click="handleSendBulkEmail"
            >
              {{ sendingBulkEmail ? 'Invio in corso...' : 'Invia email' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

