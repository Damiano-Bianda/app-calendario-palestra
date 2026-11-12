<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loginSchema } from '../../shared/schemas/auth'
import { extractApiErrorMessage } from '~/utils/ui-formatters'
import type { AuthMeResponse } from '~/composables/useAuth'

definePageMeta({
  layout: false,
})

const { authState, initialized, fetchMe, setAuthData } = useAuth()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)

onMounted(async () => {
  if (!initialized.value) {
    await fetchMe()
  }
  if (authState.value) {
    await navigateTo(authState.value.defaultRedirect || '/customer', { replace: true })
  }
})

async function handleSubmit() {
  errorMessage.value = ''

  const parsed = loginSchema.safeParse({
    email: email.value,
    password: password.value,
  })

  if (!parsed.success) {
    errorMessage.value = parsed.error.issues[0]?.message ?? 'Verifica i campi inseriti.'
    return
  }

  submitting.value = true
  try {
    const response = await $fetch<AuthMeResponse>('/api/auth/login', {
      method: 'POST',
      body: parsed.data,
    })

    setAuthData(response)
    await navigateTo(response.defaultRedirect || '/customer', { replace: true })
  } catch (err) {
    errorMessage.value = extractApiErrorMessage(err, 'Credenziali non valide.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <h1 class="text-center text-2xl font-bold tracking-tight text-slate-900">
        Calendario Palestra
      </h1>
      <p class="mt-2 text-center text-sm text-slate-600">
        Accedi con le tue credenziali per gestire o prenotare le lezioni
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-xs sm:px-8">
        <div
          v-if="errorMessage"
          role="alert"
          data-testid="login-error"
          class="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
        >
          {{ errorMessage }}
        </div>

        <form class="space-y-5" novalidate @submit.prevent="handleSubmit">
          <div>
            <label for="login-email" class="block text-sm font-medium text-slate-700">
              Indirizzo email *
            </label>
            <input
              id="login-email"
              v-model="email"
              type="email"
              name="email"
              autocomplete="email"
              required
              placeholder="nome@esempio.it"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label for="login-password" class="block text-sm font-medium text-slate-700">
              Password *
            </label>
            <input
              id="login-password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              placeholder="Inserisci la tua password"
              class="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <button
            type="submit"
            data-testid="login-submit-btn"
            :disabled="submitting"
            class="flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {{ submitting ? 'Accesso in corso...' : 'Accedi' }}
          </button>
        </form>

        <div class="mt-6 border-t border-slate-100 pt-5 text-center">
          <NuxtLink
            to="/recover"
            data-testid="forgot-password-link"
            class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
          >
            Password dimenticata? Recupera password
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

