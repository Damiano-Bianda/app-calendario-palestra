<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { changeCenterSchema, changePasswordSchema } from '../../shared/schemas/auth'
import { extractApiErrorMessage } from '~/utils/ui-formatters'

definePageMeta({
  layout: false,
  middleware: 'auth-client',
})

const {
  user,
  activeCenter,
  activeCenterId,
  centers,
  isWorker,
  currentMode,
  roleLabel,
  fetchMe,
  setMode,
  logout,
} = useAuth()

const activeLayout = computed<'worker' | 'customer'>(() =>
  isWorker.value && currentMode.value === 'worker' ? 'worker' : 'customer',
)

// Center switch state
const selectedCenterId = ref(activeCenterId.value)
const centerSaving = ref(false)
const centerSuccessMessage = ref('')
const centerErrorMessage = ref('')

watch(
  activeCenterId,
  (newId) => {
    if (newId) {
      selectedCenterId.value = newId
    }
  },
  { immediate: true },
)

async function handleCenterChange() {
  centerErrorMessage.value = ''
  centerSuccessMessage.value = ''

  const parsed = changeCenterSchema.safeParse({
    centerId: selectedCenterId.value,
  })

  if (!parsed.success) {
    centerErrorMessage.value = parsed.error.issues[0]?.message ?? 'Seleziona una sede valida.'
    return
  }

  if (parsed.data.centerId === activeCenterId.value) {
    centerSuccessMessage.value = 'Questa sede è già attiva.'
    return
  }

  centerSaving.value = true
  try {
    await $fetch('/api/settings/center', {
      method: 'PUT',
      body: parsed.data,
    })

    const updatedAuth = await fetchMe(true)
    if (updatedAuth && !updatedAuth.activeCenter.isWorker) {
      setMode('customer')
    }
    centerSuccessMessage.value = `Sede attiva aggiornata a "${updatedAuth?.activeCenter.centerName ?? 'nuova sede'}".`
  } catch (err) {
    centerErrorMessage.value = extractApiErrorMessage(err, 'Impossibile cambiare sede.')
    selectedCenterId.value = activeCenterId.value
  } finally {
    centerSaving.value = false
  }
}

// Password change state
const currentPassword = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')
const passwordSaving = ref(false)
const passwordSuccessMessage = ref('')
const passwordErrorMessage = ref('')

async function handlePasswordChange() {
  passwordErrorMessage.value = ''
  passwordSuccessMessage.value = ''

  if (newPassword.value !== confirmNewPassword.value) {
    passwordErrorMessage.value = 'La nuova password e la conferma non coincidono.'
    return
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  })

  if (!parsed.success) {
    passwordErrorMessage.value =
      parsed.error.issues[0]?.message ?? 'Verifica i campi della password.'
    return
  }

  passwordSaving.value = true
  try {
    const res = await $fetch<{ success: boolean; message: string }>('/api/settings/password', {
      method: 'PUT',
      body: parsed.data,
    })
    passwordSuccessMessage.value = res.message || 'Password modificata con successo.'
    currentPassword.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
  } catch (err) {
    passwordErrorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile modificare la password.',
    )
  } finally {
    passwordSaving.value = false
  }
}
</script>

<template>
  <NuxtLayout :name="activeLayout">
    <div class="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">
          Impostazioni
        </h1>
        <p class="mt-1 text-sm text-slate-600">
          Gestisci la sede attiva, modifica la tua password o esci dall'account.
        </p>
      </div>

      <!-- User Profile Summary Card -->
      <section class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Profilo attuale
        </h2>
        <div class="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <span class="text-slate-500">Nome e cognome:</span>
            <p class="font-semibold text-slate-900">
              {{ user ? `${user.name} ${user.surname}` : '—' }}
            </p>
          </div>
          <div>
            <span class="text-slate-500">Email:</span>
            <p class="font-semibold text-slate-900">
              {{ user?.email ?? '—' }}
            </p>
          </div>
          <div>
            <span class="text-slate-500">Ruolo nella sede attiva:</span>
            <p class="font-semibold text-slate-900">
              {{ roleLabel }}
            </p>
          </div>
          <div>
            <span class="text-slate-500">Fuso orario sede:</span>
            <p class="font-semibold text-slate-900">
              {{ activeCenter?.timezone ?? 'Europe/Rome' }}
            </p>
          </div>
        </div>
      </section>

      <!-- Section 1: Cambio centro (SPECIFICATION.md line 403) -->
      <section class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h2 class="text-base font-bold text-slate-900">
          Cambio centro
        </h2>
        <p class="mt-1 text-xs text-slate-500">
          Seleziona la sede con cui vuoi operare tra quelle a cui sei iscritto.
        </p>

        <div
          v-if="centerErrorMessage"
          role="alert"
          class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {{ centerErrorMessage }}
        </div>

        <div
          v-if="centerSuccessMessage"
          role="status"
          class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {{ centerSuccessMessage }}
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="handleCenterChange">
          <div>
            <label for="center-select" class="block text-sm font-medium text-slate-700">
              Sede attiva
            </label>
            <select
              id="center-select"
              v-model="selectedCenterId"
              data-testid="settings-center-select"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option
                v-for="c in centers"
                :key="c.centerId"
                :value="c.centerId"
              >
                {{ c.centerName }} ({{ c.timezone }})
              </option>
            </select>
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              data-testid="settings-center-submit"
              :disabled="centerSaving || selectedCenterId === activeCenterId"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-2xs transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ centerSaving ? 'Aggiornamento...' : 'Cambia sede' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Section 2: Cambio password (SPECIFICATION.md line 403) -->
      <section class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h2 class="text-base font-bold text-slate-900">
          Cambio password
        </h2>
        <p class="mt-1 text-xs text-slate-500">
          Inserisci la tua password attuale e scegli una nuova password di almeno 8 caratteri.
        </p>

        <div
          v-if="passwordErrorMessage"
          role="alert"
          class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {{ passwordErrorMessage }}
        </div>

        <div
          v-if="passwordSuccessMessage"
          role="status"
          class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {{ passwordSuccessMessage }}
        </div>

        <form class="mt-4 space-y-4" novalidate @submit.prevent="handlePasswordChange">
          <div>
            <label for="current-password" class="block text-sm font-medium text-slate-700">
              Password attuale *
            </label>
            <input
              id="current-password"
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              placeholder="Inserisci la password attuale"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label for="settings-new-password" class="block text-sm font-medium text-slate-700">
              Nuova password *
            </label>
            <input
              id="settings-new-password"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              required
              placeholder="Almeno 8 caratteri"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label for="settings-confirm-password" class="block text-sm font-medium text-slate-700">
              Conferma nuova password *
            </label>
            <input
              id="settings-confirm-password"
              v-model="confirmNewPassword"
              type="password"
              autocomplete="new-password"
              required
              placeholder="Ripeti la nuova password"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              data-testid="settings-password-submit"
              :disabled="passwordSaving"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-2xs transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ passwordSaving ? 'Salvataggio...' : 'Aggiorna password' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Section 3: Pulsante Logout (SPECIFICATION.md line 403) -->
      <section class="rounded-xl border border-red-200 bg-white p-5 shadow-2xs">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-bold text-slate-900">
              Disconnessione
            </h2>
            <p class="mt-0.5 text-xs text-slate-500">
              Termina la sessione corrente su questo dispositivo.
            </p>
          </div>
          <button
            type="button"
            data-testid="settings-logout-btn"
            class="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-red-700"
            @click="logout"
          >
            Logout
          </button>
        </div>
      </section>
    </div>
  </NuxtLayout>
</template>

