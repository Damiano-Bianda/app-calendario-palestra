<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createUserSubscriptionSchema,
} from '../../../shared/schemas/subscriptions'
import {
  createUserSchema,
  sendUsersEmailSchema,
  updateUserProfileSchema,
  updateUserRolesSchema,
} from '../../../shared/schemas/users'
import {
  formatCenterDate,
  localDateTimeToUtcIso,
} from '../../../shared/utils/timezone'
import type { SubscriptionRecord } from '~/components/worker/SubscriptionForm.vue'
import {
  extractApiErrorMessage,
  getTodayInCenterTimezone,
} from '~/utils/ui-formatters'

export interface WorkerUserRecord {
  id: string
  membershipId: string
  centerId: string
  email: string
  name: string
  surname: string
  phoneNumber: string
  isManager: boolean
  isAssistantManager: boolean
  isInstructor: boolean
  createdAt: string
  updatedAt: string
}

export interface UserSubscriptionDetailItem {
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
}

const props = defineProps<{
  mode: 'create' | 'edit'
  initialUser?: WorkerUserRecord | null
  userSubscriptions?: UserSubscriptionDetailItem[]
  subscriptionTemplates?: SubscriptionRecord[]
  readOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const { isManager, centerTimezone } = useAuth()

const form = reactive({
  name: props.initialUser?.name ?? '',
  surname: props.initialUser?.surname ?? '',
  phoneNumber: props.initialUser?.phoneNumber ?? '',
  email: props.initialUser?.email ?? '',
  isInstructor: Boolean(props.initialUser?.isInstructor),
  isAssistantManager: Boolean(props.initialUser?.isAssistantManager),
})

watch(
  () => props.initialUser,
  (u) => {
    if (!u) return
    form.name = u.name
    form.surname = u.surname
    form.phoneNumber = u.phoneNumber
    form.email = u.email
    form.isInstructor = u.isInstructor
    form.isAssistantManager = u.isAssistantManager
  },
  { immediate: true },
)

const fieldErrors = ref<Record<string, string>>({})
const generalError = ref('')
const successMessage = ref('')
const submitting = ref(false)
const deleting = ref(false)

const showDeleteDialog = ref(false)
const showResetPasswordDialog = ref(false)
const resettingPassword = ref(false)

// Email modal state
const showEmailModal = ref(false)
const emailSubject = ref('')
const emailMessage = ref('')
const sendingEmail = ref(false)
const emailError = ref('')

// Assign subscription modal state (SPECIFICATION.md lines 178-182, 399)
const showAssignSubscriptionModal = ref(false)
const assignSubForm = reactive({
  subscriptionId: '',
  localStartDate: getTodayInCenterTimezone(centerTimezone.value),
})
const assignSubError = ref('')
const assigningSub = ref(false)

const selectedTemplate = computed(() =>
  (props.subscriptionTemplates ?? []).find((t) => t.id === assignSubForm.subscriptionId) ?? null,
)

const prefilledTemplatePreview = computed(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return null
  let endPreview = 'Illimitata'
  if (tpl.durationDays !== null && /^\d{4}-\d{2}-\d{2}$/.test(assignSubForm.localStartDate)) {
    try {
      const startIso = localDateTimeToUtcIso(
        assignSubForm.localStartDate,
        '00:00',
        centerTimezone.value,
      )
      const endMs = Date.parse(startIso) + tpl.durationDays * 86_400_000
      endPreview = formatCenterDate(new Date(endMs).toISOString(), centerTimezone.value)
    } catch {
      endPreview = `${tpl.durationDays} giorni dalla data di inizio`
    }
  }
  return {
    entrancesLabel: tpl.entrances !== null ? `${tpl.entrances} entrate` : 'Illimitate',
    endDateLabel: endPreview,
  }
})

function openAssignModal() {
  assignSubError.value = ''
  assignSubForm.subscriptionId = props.subscriptionTemplates?.[0]?.id ?? ''
  assignSubForm.localStartDate = getTodayInCenterTimezone(centerTimezone.value)
  showAssignSubscriptionModal.value = true
}

async function handleSubmit() {
  if (props.readOnly) return
  fieldErrors.value = {}
  generalError.value = ''
  successMessage.value = ''

  if (props.mode === 'create') {
    const payload = {
      name: form.name.trim(),
      surname: form.surname.trim(),
      phoneNumber: form.phoneNumber.trim(),
      email: form.email.trim(),
      isInstructor: form.isInstructor,
      // SPECIFICATION.md line 22 & 116: Only the Manager can create Assistant Managers
      isAssistantManager: isManager.value ? form.isAssistantManager : false,
    }

    const parsed = createUserSchema.safeParse(payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'general')
        if (!fieldErrors.value[key]) {
          fieldErrors.value[key] = issue.message
        }
      }
      return
    }

    submitting.value = true
    try {
      await $fetch('/api/users', {
        method: 'POST',
        body: parsed.data,
      })
      await navigateTo('/worker/users')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        "Impossibile creare o abilitare l'utente nella sede.",
      )
    } finally {
      submitting.value = false
    }
  } else if (props.initialUser) {
    const profilePayload = {
      name: form.name.trim(),
      surname: form.surname.trim(),
      phoneNumber: form.phoneNumber.trim(),
    }

    const parsedProfile = updateUserProfileSchema.safeParse(profilePayload)
    if (!parsedProfile.success) {
      for (const issue of parsedProfile.error.issues) {
        const key = String(issue.path[0] ?? 'general')
        if (!fieldErrors.value[key]) {
          fieldErrors.value[key] = issue.message
        }
      }
      return
    }

    const rolesPayload = {
      isInstructor: form.isInstructor,
      ...(isManager.value ? { isAssistantManager: form.isAssistantManager } : {}),
    }

    const parsedRoles = updateUserRolesSchema.safeParse(rolesPayload)
    if (!parsedRoles.success) {
      generalError.value = parsedRoles.error.issues[0]?.message ?? 'Ruoli non validi.'
      return
    }

    submitting.value = true
    try {
      await $fetch(`/api/users/${props.initialUser.id}`, {
        method: 'PUT',
        body: parsedProfile.data,
      })

      const rolesChanged =
        form.isInstructor !== props.initialUser.isInstructor ||
        (isManager.value && form.isAssistantManager !== props.initialUser.isAssistantManager)

      if (rolesChanged) {
        await $fetch(`/api/users/${props.initialUser.id}/roles`, {
          method: 'PUT',
          body: parsedRoles.data,
        })
      }

      successMessage.value = 'Dati utente aggiornati con successo.'
      emit('refresh')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        'Impossibile salvare le modifiche al cliente.',
      )
    } finally {
      submitting.value = false
    }
  }
}

async function handleConfirmDelete() {
  if (!props.initialUser || props.readOnly) return
  deleting.value = true
  generalError.value = ''

  try {
    await $fetch(`/api/users/${props.initialUser.id}`, {
      method: 'DELETE',
    })
    showDeleteDialog.value = false
    await navigateTo('/worker/users')
  } catch (err) {
    showDeleteDialog.value = false
    generalError.value = extractApiErrorMessage(
      err,
      "Impossibile eliminare l'utente dalla sede.",
    )
  } finally {
    deleting.value = false
  }
}

async function handleConfirmResetPassword() {
  if (!props.initialUser || props.readOnly) return
  resettingPassword.value = true
  generalError.value = ''
  successMessage.value = ''

  try {
    await $fetch(`/api/users/${props.initialUser.id}/reset-password`, {
      method: 'POST',
    })
    showResetPasswordDialog.value = false
    successMessage.value = `Nuova password generata e inviata via email a ${props.initialUser.email}.`
  } catch (err) {
    showResetPasswordDialog.value = false
    generalError.value = extractApiErrorMessage(
      err,
      'Impossibile resettare la password del cliente.',
    )
  } finally {
    resettingPassword.value = false
  }
}

async function handleSendEmailToUser() {
  if (!props.initialUser || props.readOnly) return
  emailError.value = ''

  const parsed = sendUsersEmailSchema.safeParse({
    userIds: [props.initialUser.id],
    subject: emailSubject.value.trim() || undefined,
    message: emailMessage.value.trim(),
  })
  if (!parsed.success) {
    emailError.value = parsed.error.issues[0]?.message ?? 'Inserisci un messaggio valido.'
    return
  }

  sendingEmail.value = true
  try {
    await $fetch('/api/users/email', {
      method: 'POST',
      body: parsed.data,
    })
    showEmailModal.value = false
    emailSubject.value = ''
    emailMessage.value = ''
    successMessage.value = `Email inviata con successo a ${props.initialUser.email}.`
  } catch (err) {
    emailError.value = extractApiErrorMessage(
      err,
      "Impossibile inviare l'email al cliente.",
    )
  } finally {
    sendingEmail.value = false
  }
}

async function handleAssignSubscription() {
  if (!props.initialUser || props.readOnly) return
  assignSubError.value = ''

  let startDateIso: string
  try {
    startDateIso = localDateTimeToUtcIso(
      assignSubForm.localStartDate,
      '00:00',
      centerTimezone.value,
    )
  } catch (err) {
    assignSubError.value = err instanceof Error ? err.message : 'Data di inizio non valida.'
    return
  }

  const parsed = createUserSubscriptionSchema.safeParse({
    userId: props.initialUser.id,
    subscriptionId: assignSubForm.subscriptionId,
    startDate: startDateIso,
  })
  if (!parsed.success) {
    assignSubError.value = parsed.error.issues[0]?.message ?? 'Dati sottoscrizione non validi.'
    return
  }

  assigningSub.value = true
  try {
    await $fetch('/api/user-subscriptions', {
      method: 'POST',
      body: parsed.data,
    })
    showAssignSubscriptionModal.value = false
    successMessage.value = "Sottoscrizione d'abbonamento assegnata con successo."
    emit('refresh')
  } catch (err) {
    assignSubError.value = extractApiErrorMessage(
      err,
      "Impossibile assegnare la sottoscrizione d'abbonamento.",
    )
  } finally {
    assigningSub.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <!-- Top Header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <NuxtLink
          to="/worker/users"
          class="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          ← Torna alla lista clienti
        </NuxtLink>
        <h1 class="mt-1 text-2xl font-bold text-slate-900">
          {{
            mode === 'create'
              ? 'Nuovo cliente / utente'
              : readOnly
                ? 'Dettaglio cliente'
                : 'Gestione cliente'
          }}
        </h1>
      </div>

      <!-- SPECIFICATION.md line 399: "In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma" -->
      <button
        v-if="mode === 'edit' && !readOnly && !initialUser?.isManager"
        type="button"
        data-testid="delete-user-btn"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
        @click="showDeleteDialog = true"
      >
        Elimina utente
      </button>
    </div>

    <!-- Action Bar in Edit Mode (Add subscription, Reset password, Send email) -->
    <!-- SPECIFICATION.md line 399: "pulsante per aggiungere sottoscrizione e per resettare password, e pulsante per inviare un'email al cliente" -->
    <div
      v-if="mode === 'edit' && !readOnly && initialUser"
      class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
    >
      <button
        type="button"
        data-testid="add-user-subscription-btn"
        class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700"
        @click="openAssignModal"
      >
        + Aggiungi sottoscrizione
      </button>

      <button
        type="button"
        data-testid="reset-user-password-btn"
        class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
        @click="showResetPasswordDialog = true"
      >
        Resetta password
      </button>

      <button
        type="button"
        data-testid="email-single-user-btn"
        class="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
        @click="showEmailModal = true"
      >
        ✉ Invia email al cliente
      </button>
    </div>

    <div
      v-if="generalError"
      class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ generalError }}
    </div>

    <div
      v-if="successMessage"
      class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
    >
      {{ successMessage }}
    </div>

    <!-- User Profile & Roles Form -->
    <form
      class="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
      @submit.prevent="handleSubmit"
    >
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Nome <span v-if="!readOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            maxlength="255"
            :disabled="readOnly"
            placeholder="Nome"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="fieldErrors.name" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.name }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Cognome <span v-if="!readOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.surname"
            type="text"
            maxlength="255"
            :disabled="readOnly"
            placeholder="Cognome"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="fieldErrors.surname" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.surname }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Numero di telefono (E.164) <span v-if="!readOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.phoneNumber"
            type="tel"
            maxlength="20"
            :disabled="readOnly"
            placeholder="+393331234567"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p class="mt-0.5 text-[11px] text-slate-500">
            Formato internazionale senza spazi (es. +393331234567).
          </p>
          <p v-if="fieldErrors.phoneNumber" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.phoneNumber }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Email <span v-if="mode === 'create' && !readOnly" class="text-red-600">*</span>
          </label>
          <input
            v-model="form.email"
            type="email"
            maxlength="255"
            :disabled="readOnly || mode === 'edit'"
            placeholder="cliente@esempio.it"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="fieldErrors.email" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.email }}
          </p>
        </div>
      </div>

      <!-- Roles in Center -->
      <div class="space-y-3 border-t border-slate-200 pt-5">
        <h2 class="text-sm font-bold text-slate-900">
          Ruoli nella sede
        </h2>
        <p class="text-xs text-slate-500">
          Se non viene selezionato alcun ruolo lavoratore, l'utente opera esclusivamente come Cliente.
        </p>

        <div v-if="initialUser?.isManager" class="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs font-semibold text-indigo-900">
          Questo utente è il <strong>Gerente</strong> della sede (ruolo unico e non rimovibile).
        </div>

        <div class="space-y-2.5">
          <label class="flex items-center gap-2.5 text-sm font-medium text-slate-800">
            <input
              v-model="form.isInstructor"
              type="checkbox"
              :disabled="readOnly"
              class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span>Istruttore (può tenere corsi e visualizzare il gestionale in sola lettura)</span>
          </label>

          <!-- SPECIFICATION.md line 22 & 116: Solo il gerente può creare/modificare altri vice gerenti -->
          <label
            v-if="isManager || form.isAssistantManager"
            class="flex items-center gap-2.5 text-sm font-medium text-slate-800"
          >
            <input
              v-model="form.isAssistantManager"
              type="checkbox"
              :disabled="readOnly || !isManager"
              class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span>
              Vice gerente (può gestire corsi, lezioni, abbonamenti e clienti)
              <span v-if="!isManager" class="text-xs text-slate-500">(modificabile solo dal Gerente)</span>
            </span>
          </label>
        </div>
      </div>

      <div v-if="!readOnly" class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <NuxtLink
          to="/worker/users"
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Annulla
        </NuxtLink>
        <button
          type="submit"
          :disabled="submitting"
          class="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ submitting ? 'Salvataggio...' : 'Salva' }}
        </button>
      </div>
    </form>

    <!-- User's Subscriptions List (in Edit/Detail mode) -->
    <!-- SPECIFICATION.md lines 185, 399, 402: clicking a subscription opens /worker/user-subscriptions?user=userId -->
    <div
      v-if="mode === 'edit' && initialUser"
      class="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-900">
            Sottoscrizioni d'abbonamento del cliente
          </h2>
          <p class="text-xs text-slate-500">
            Clicca su una sottoscrizione o su «Gestisci sottoscrizioni» per modificare la data di scadenza o le entrate totali.
          </p>
        </div>

        <NuxtLink
          :to="`/worker/user-subscriptions?user=${initialUser.id}`"
          class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {{ readOnly ? 'Vedi tutte le sottoscrizioni →' : 'Gestisci sottoscrizioni →' }}
        </NuxtLink>
      </div>

      <div
        v-if="!userSubscriptions || userSubscriptions.length === 0"
        class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500"
      >
        Nessuna sottoscrizione d'abbonamento associata a questo cliente.
      </div>

      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NuxtLink
          v-for="sub in userSubscriptions"
          :key="sub.id"
          :to="`/worker/user-subscriptions?user=${initialUser.id}`"
          class="block rounded-xl border p-4 transition hover:border-indigo-400 hover:shadow-xs"
          :class="sub.isActive ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50'"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-900">{{ sub.subscription.name }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              :class="
                sub.isActive
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              "
            >
              {{ sub.isActive ? 'Attiva' : 'Scaduta / Esaurita' }}
            </span>
          </div>

          <div class="mt-2 space-y-1 text-xs text-slate-600">
            <div>
              Validità:
              <strong>{{ formatCenterDate(sub.startDate, centerTimezone) }}</strong>
              →
              <strong>
                {{ sub.endDate ? formatCenterDate(sub.endDate, centerTimezone) : 'Illimitata' }}
              </strong>
            </div>
            <div>
              Entrate rimanenti:
              <strong>
                {{
                  sub.remainingEntrances !== null
                    ? `${sub.remainingEntrances} su ${sub.entrances}`
                    : 'Illimitate'
                }}
              </strong>
              <span class="text-slate-400">({{ sub.usedEntrances }} usate)</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Delete User Dialog -->
    <ConfirmDialog
      :open="showDeleteDialog"
      title="Elimina utente dalla sede"
      :description="`Sei sicuro di voler eliminare «${initialUser?.name ?? ''} ${initialUser?.surname ?? ''}» dalla sede? L'operazione verrà bloccata se l'utente ha lezioni attive o sottoscrizioni attive.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deleting"
      @close="showDeleteDialog = false"
      @confirm="handleConfirmDelete"
    />

    <!-- Reset Password Dialog -->
    <ConfirmDialog
      :open="showResetPasswordDialog"
      title="Resetta password cliente"
      :description="`Vuoi generare una nuova password casuale per «${initialUser?.email ?? ''}» e inviarla via email all'utente?`"
      confirm-label="Resetta e invia email"
      variant="primary"
      :loading="resettingPassword"
      @close="showResetPasswordDialog = false"
      @confirm="handleConfirmResetPassword"
    />

    <!-- Assign Subscription Modal (SPECIFICATION.md lines 178-182) -->
    <Teleport to="body">
      <div
        v-if="showAssignSubscriptionModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        @click.self="!assigningSub && (showAssignSubscriptionModal = false)"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
          <h3 class="text-lg font-bold text-slate-900">
            Assegna sottoscrizione d'abbonamento
          </h3>
          <p class="mt-1 text-xs text-slate-600">
            Scegli un template d'abbonamento: i campi vengono pre-compilati in automatico. Puoi modificare la data d'inizio prima di salvare.
          </p>

          <div
            v-if="assignSubError"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ assignSubError }}
          </div>

          <div class="mt-4 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Abbonamento <span class="text-red-600">*</span>
              </label>
              <select
                v-model="assignSubForm.subscriptionId"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="" disabled>Seleziona abbonamento...</option>
                <option
                  v-for="tpl in subscriptionTemplates"
                  :key="tpl.id"
                  :value="tpl.id"
                >
                  {{ tpl.name }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Data d'inizio ({{ centerTimezone }}) <span class="text-red-600">*</span>
              </label>
              <input
                v-model="assignSubForm.localStartDate"
                type="date"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <!-- Pre-filled fields preview -->
            <div
              v-if="prefilledTemplatePreview"
              class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1"
            >
              <div>
                Entrate pre-compilate:
                <strong>{{ prefilledTemplatePreview.entrancesLabel }}</strong>
              </div>
              <div>
                Data di scadenza calcolata:
                <strong>{{ prefilledTemplatePreview.endDateLabel }}</strong>
              </div>
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              :disabled="assigningSub"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              @click="showAssignSubscriptionModal = false"
            >
              Annulla
            </button>
            <button
              type="button"
              :disabled="assigningSub || !assignSubForm.subscriptionId"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              @click="handleAssignSubscription"
            >
              {{ assigningSub ? 'Salvataggio...' : 'Salva sottoscrizione' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Send Email to Customer Modal -->
    <Teleport to="body">
      <div
        v-if="showEmailModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        @click.self="!sendingEmail && (showEmailModal = false)"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
          <h3 class="text-lg font-bold text-slate-900">
            Invia email a {{ initialUser?.name }} {{ initialUser?.surname }}
          </h3>
          <p class="mt-1 text-xs text-slate-600">
            Destinatario: {{ initialUser?.email }}
          </p>

          <div
            v-if="emailError"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            {{ emailError }}
          </div>

          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">
                Oggetto <span class="text-slate-400 font-normal">(facoltativo)</span>
              </label>
              <input
                v-model="emailSubject"
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
                v-model="emailMessage"
                rows="4"
                maxlength="2000"
                placeholder="Scrivi il messaggio per il cliente..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              :disabled="sendingEmail"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              @click="showEmailModal = false"
            >
              Annulla
            </button>
            <button
              type="button"
              :disabled="sendingEmail"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              @click="handleSendEmailToUser"
            >
              {{ sendingEmail ? 'Invio in corso...' : 'Invia email' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

