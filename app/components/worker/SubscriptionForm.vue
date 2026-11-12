<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
} from '../../../shared/schemas/subscriptions'
import { extractApiErrorMessage } from '~/utils/ui-formatters'

export interface SubscriptionClassItem {
  id: string
  name: string
  color: string
}

export interface SubscriptionRecord {
  id: string
  centerId: string
  name: string
  description: string | null
  entrances: number | null
  durationDays: number | null
  classes: SubscriptionClassItem[]
  classIds: string[]
  createdAt: string
  updatedAt: string
}

const props = defineProps<{
  mode: 'create' | 'edit'
  initialSubscription?: SubscriptionRecord | null
  classesOptions: SubscriptionClassItem[]
  readOnly?: boolean
}>()

// Structural fields (entrances, durationDays, classIds) are read-only in edit mode (SPECIFICATION.md line 166)
const areStructuralFieldsReadOnly = computed(
  () => Boolean(props.readOnly) || props.mode === 'edit',
)

const form = reactive({
  name: props.initialSubscription?.name ?? '',
  description: props.initialSubscription?.description ?? '',
  entrances:
    props.initialSubscription?.entrances !== null &&
    props.initialSubscription?.entrances !== undefined
      ? String(props.initialSubscription.entrances)
      : '',
  durationDays:
    props.initialSubscription?.durationDays !== null &&
    props.initialSubscription?.durationDays !== undefined
      ? String(props.initialSubscription.durationDays)
      : '',
  classIds: [...(props.initialSubscription?.classIds ?? [])] as string[],
})

watch(
  () => props.initialSubscription,
  (val) => {
    if (val) {
      form.name = val.name
      form.description = val.description ?? ''
      form.entrances = val.entrances !== null ? String(val.entrances) : ''
      form.durationDays = val.durationDays !== null ? String(val.durationDays) : ''
      form.classIds = [...val.classIds]
    }
  },
  { immediate: true },
)

const fieldErrors = ref<Record<string, string>>({})
const generalError = ref('')
const submitting = ref(false)
const deleting = ref(false)
const showDeleteDialog = ref(false)

function toggleClassId(classId: string) {
  if (areStructuralFieldsReadOnly.value) return
  const idx = form.classIds.indexOf(classId)
  if (idx >= 0) {
    form.classIds.splice(idx, 1)
  } else {
    form.classIds.push(classId)
  }
}

async function handleSubmit() {
  if (props.readOnly) return
  fieldErrors.value = {}
  generalError.value = ''

  if (props.mode === 'create') {
    const entrancesStr = String(form.entrances ?? '').trim()
    const durationStr = String(form.durationDays ?? '').trim()

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      entrances: entrancesStr === '' ? null : Number.parseInt(entrancesStr, 10),
      durationDays: durationStr === '' ? null : Number.parseInt(durationStr, 10),
      classIds: form.classIds,
    }

    const parsed = createSubscriptionSchema.safeParse(payload)
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
      await $fetch('/api/subscriptions', {
        method: 'POST',
        body: parsed.data,
      })
      await navigateTo('/worker/subscriptions')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        "Impossibile creare l'abbonamento.",
      )
    } finally {
      submitting.value = false
    }
  } else if (props.initialSubscription) {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
    }

    const parsed = updateSubscriptionSchema.safeParse(payload)
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
      await $fetch(`/api/subscriptions/${props.initialSubscription.id}`, {
        method: 'PUT',
        body: parsed.data,
      })
      await navigateTo('/worker/subscriptions')
    } catch (err) {
      generalError.value = extractApiErrorMessage(
        err,
        "Impossibile modificare l'abbonamento.",
      )
    } finally {
      submitting.value = false
    }
  }
}

async function confirmDelete() {
  if (!props.initialSubscription || props.readOnly) return
  deleting.value = true
  generalError.value = ''

  try {
    await $fetch(`/api/subscriptions/${props.initialSubscription.id}`, {
      method: 'DELETE',
    })
    showDeleteDialog.value = false
    await navigateTo('/worker/subscriptions')
  } catch (err) {
    showDeleteDialog.value = false
    generalError.value = extractApiErrorMessage(
      err,
      "Impossibile eliminare l'abbonamento.",
    )
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <NuxtLink
          to="/worker/subscriptions"
          class="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          ← Torna alla lista abbonamenti
        </NuxtLink>
        <h1 class="mt-1 text-2xl font-bold text-slate-900">
          {{
            mode === 'create'
              ? 'Nuovo abbonamento'
              : readOnly
                ? 'Dettaglio abbonamento'
                : 'Modifica abbonamento'
          }}
        </h1>
      </div>

      <!-- SPECIFICATION.md line 397: "In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma" -->
      <button
        v-if="mode === 'edit' && !readOnly"
        type="button"
        data-testid="delete-subscription-btn"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
        @click="showDeleteDialog = true"
      >
        Elimina abbonamento
      </button>
    </div>

    <div
      v-if="generalError"
      class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ generalError }}
    </div>

    <form
      class="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
      @submit.prevent="handleSubmit"
    >
      <!-- Nome abbonamento -->
      <div>
        <label class="block text-sm font-semibold text-slate-800">
          Nome dell'abbonamento <span v-if="!readOnly" class="text-red-600">*</span>
        </label>
        <input
          v-model="form.name"
          type="text"
          maxlength="255"
          :disabled="readOnly"
          placeholder="Es. Carnet 10 Ingressi, Abbonamento Mensile Open..."
          class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
        />
        <p v-if="fieldErrors.name" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.name }}
        </p>
      </div>

      <!-- Entrate & Durata in giorni (sola lettura in modifica per SPECIFICATION.md line 166) -->
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Numero di entrate
            <span class="text-xs font-normal text-slate-500">(vuoto = illimitate)</span>
          </label>
          <input
            v-model="form.entrances"
            type="number"
            min="1"
            step="1"
            :disabled="areStructuralFieldsReadOnly"
            placeholder="Illimitate"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="mode === 'edit'" class="mt-1 text-[11px] text-slate-500">
            Campo strutturale non modificabile dopo la creazione.
          </p>
          <p v-if="fieldErrors.entrances" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.entrances }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-slate-800">
            Durata in giorni
            <span class="text-xs font-normal text-slate-500">(vuoto = illimitata)</span>
          </label>
          <input
            v-model="form.durationDays"
            type="number"
            min="1"
            step="1"
            :disabled="areStructuralFieldsReadOnly"
            placeholder="Illimitata"
            class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
          />
          <p v-if="mode === 'edit'" class="mt-1 text-[11px] text-slate-500">
            Campo strutturale non modificabile dopo la creazione.
          </p>
          <p v-if="fieldErrors.durationDays" class="mt-1 text-xs font-medium text-red-600">
            {{ fieldErrors.durationDays }}
          </p>
        </div>
      </div>

      <!-- Corsi abilitati (almeno uno obbligatorio in creazione, sola lettura in modifica) -->
      <div>
        <label class="block text-sm font-semibold text-slate-800">
          Corsi associati <span v-if="!areStructuralFieldsReadOnly" class="text-red-600">*</span>
        </label>
        <p v-if="mode === 'edit'" class="mt-0.5 text-[11px] text-slate-500">
          I corsi abilitati di un template d'abbonamento sono in sola lettura dopo la creazione.
        </p>

        <div
          v-if="classesOptions.length === 0"
          class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          Nessun corso disponibile nella sede. Crea almeno un corso prima di creare un abbonamento.
        </div>

        <div v-else class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="cls in classesOptions"
            :key="cls.id"
            type="button"
            :disabled="areStructuralFieldsReadOnly"
            class="flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition disabled:cursor-default"
            :class="
              form.classIds.includes(cls.id)
                ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 ring-1 ring-indigo-600/30'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60'
            "
            @click="toggleClassId(cls.id)"
          >
            <div class="flex items-center gap-2 truncate">
              <ClassColorBadge :color="cls.color" :show-label="false" />
              <span class="truncate">{{ cls.name }}</span>
            </div>
            <span
              class="ml-2 text-xs font-bold"
              :class="form.classIds.includes(cls.id) ? 'text-indigo-600' : 'text-slate-300'"
            >
              {{ form.classIds.includes(cls.id) ? '✓' : '' }}
            </span>
          </button>
        </div>
        <p v-if="fieldErrors.classIds" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.classIds }}
        </p>
      </div>

      <!-- Descrizione facoltativa -->
      <div>
        <label class="block text-sm font-semibold text-slate-800">
          Descrizione <span class="text-xs font-normal text-slate-500">(facoltativa)</span>
        </label>
        <textarea
          v-model="form.description"
          rows="3"
          maxlength="1000"
          :disabled="readOnly"
          placeholder="Eventuale descrizione dell'abbonamento..."
          class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
        />
        <p v-if="fieldErrors.description" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.description }}
        </p>
      </div>

      <!-- Actions (hidden for read-only instructors) -->
      <div v-if="!readOnly" class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <NuxtLink
          to="/worker/subscriptions"
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

    <ConfirmDialog
      :open="showDeleteDialog"
      title="Elimina abbonamento"
      :description="`Sei sicuro di voler eliminare l'abbonamento «${initialSubscription?.name ?? ''}»? L'eliminazione verrà bloccata se esistono clienti con una sottoscrizione attiva per questo abbonamento.`"
      confirm-label="Elimina"
      variant="danger"
      :loading="deleting"
      @close="showDeleteDialog = false"
      @confirm="confirmDelete"
    />
  </div>
</template>

