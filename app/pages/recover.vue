<script setup lang="ts">
import { computed, ref } from 'vue'
import { recoverPasswordSchema, resetPasswordSchema } from '../../shared/schemas/auth'
import { extractApiErrorMessage } from '~/utils/ui-formatters'

definePageMeta({
  layout: false,
})

const route = useRoute()

const tokenFromQuery = computed(() => {
  const raw = route.query.token
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : ''
})

const hasToken = computed(() => tokenFromQuery.value.length > 0)

// Request recovery link state
const email = ref('')
const requestSuccessMessage = ref('')
const requestErrorMessage = ref('')
const requesting = ref(false)

// Reset password state
const newPassword = ref('')
const confirmPassword = ref('')
const resetSuccessMessage = ref('')
const resetErrorMessage = ref('')
const resetting = ref(false)

async function handleRequestRecovery() {
  requestErrorMessage.value = ''
  requestSuccessMessage.value = ''

  const parsed = recoverPasswordSchema.safeParse({
    email: email.value,
  })

  if (!parsed.success) {
    requestErrorMessage.value = parsed.error.issues[0]?.message ?? 'Inserisci un indirizzo email valido.'
    return
  }

  requesting.value = true
  try {
    const res = await $fetch<{ success: boolean; message: string }>('/api/auth/recover', {
      method: 'POST',
      body: parsed.data,
    })
    requestSuccessMessage.value =
      res.message ||
      "Se l'indirizzo email è associato a un account attivo, riceverai un link per reimpostare la password."
  } catch (err) {
    requestErrorMessage.value = extractApiErrorMessage(
      err,
      'Impossibile inviare il link di recupero password.',
    )
  } finally {
    requesting.value = false
  }
}

async function handleResetPassword() {
  resetErrorMessage.value = ''
  resetSuccessMessage.value = ''

  if (newPassword.value !== confirmPassword.value) {
    resetErrorMessage.value = 'Le password non coincidono.'
    return
  }

  const parsed = resetPasswordSchema.safeParse({
    token: tokenFromQuery.value,
    newPassword: newPassword.value,
  })

  if (!parsed.success) {
    resetErrorMessage.value = parsed.error.issues[0]?.message ?? 'Verifica la nuova password inserita.'
    return
  }

  resetting.value = true
  try {
    const res = await $fetch<{ success: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: parsed.data,
    })
    resetSuccessMessage.value = res.message || 'Password aggiornata con successo.'
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (err) {
    resetErrorMessage.value = extractApiErrorMessage(
      err,
      'Token di recupero non valido o scaduto.',
    )
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <h1 class="text-center text-2xl font-bold tracking-tight text-slate-900">
        {{ hasToken ? 'Imposta nuova password' : 'Recupero password' }}
      </h1>
      <p class="mt-2 text-center text-sm text-slate-600">
        {{
          hasToken
            ? 'Inserisci la nuova password per il tuo account (minimo 8 caratteri).'
            : 'Inserisci la tua email per ricevere un link temporaneo (valido 30 minuti) di reimpostazione.'
        }}
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-xs sm:px-8">
        <!-- MODE 1: Request reset link via email -->
        <template v-if="!hasToken">
          <div
            v-if="requestErrorMessage"
            role="alert"
            data-testid="recover-error"
            class="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
          >
            {{ requestErrorMessage }}
          </div>

          <div
            v-if="requestSuccessMessage"
            role="status"
            data-testid="recover-success"
            class="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          >
            {{ requestSuccessMessage }}
          </div>

          <form class="space-y-5" novalidate @submit.prevent="handleRequestRecovery">
            <div>
              <label for="recover-email" class="block text-sm font-medium text-slate-700">
                Indirizzo email *
              </label>
              <input
                id="recover-email"
                v-model="email"
                type="email"
                name="email"
                autocomplete="email"
                required
                placeholder="nome@esempio.it"
                class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <button
              type="submit"
              data-testid="recover-submit-btn"
              :disabled="requesting"
              class="flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ requesting ? 'Invio in corso...' : 'Invia link di recupero' }}
            </button>
          </form>
        </template>

        <!-- MODE 2: Reset password with token -->
        <template v-else>
          <div
            v-if="resetErrorMessage"
            role="alert"
            data-testid="reset-error"
            class="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
          >
            <p>{{ resetErrorMessage }}</p>
            <NuxtLink
              to="/recover"
              class="mt-2 inline-block text-xs font-semibold text-red-800 underline hover:text-red-900"
            >
              Richiedi un nuovo link di recupero
            </NuxtLink>
          </div>

          <div
            v-if="resetSuccessMessage"
            role="status"
            data-testid="reset-success"
            class="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          >
            <p class="font-medium">{{ resetSuccessMessage }}</p>
            <NuxtLink
              to="/login"
              class="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700"
            >
              Vai al Login
            </NuxtLink>
          </div>

          <form
            v-else
            class="space-y-5"
            novalidate
            @submit.prevent="handleResetPassword"
          >
            <div>
              <label for="new-password" class="block text-sm font-medium text-slate-700">
                Nuova password *
              </label>
              <input
                id="new-password"
                v-model="newPassword"
                type="password"
                name="newPassword"
                autocomplete="new-password"
                required
                placeholder="Almeno 8 caratteri"
                class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label for="confirm-password" class="block text-sm font-medium text-slate-700">
                Conferma nuova password *
              </label>
              <input
                id="confirm-password"
                v-model="confirmPassword"
                type="password"
                name="confirmPassword"
                autocomplete="new-password"
                required
                placeholder="Ripeti la nuova password"
                class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <button
              type="submit"
              data-testid="reset-submit-btn"
              :disabled="resetting"
              class="flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ resetting ? 'Salvataggio in corso...' : 'Salva nuova password' }}
            </button>
          </form>
        </template>

        <div class="mt-6 border-t border-slate-100 pt-5 text-center">
          <NuxtLink
            to="/login"
            class="text-xs font-semibold text-slate-600 transition hover:text-indigo-600"
          >
            ← Torna alla pagina di login
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

