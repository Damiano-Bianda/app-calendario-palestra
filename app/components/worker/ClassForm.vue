<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { createClassSchema, updateClassSchema } from '../../../shared/schemas/classes'
import { CLASS_COLORS, type ClassColor } from '../../../shared/schemas/common'
import { CLASS_COLOR_STYLES, extractApiErrorMessage } from '~/utils/ui-formatters'

export interface ClassRecord {
  id: string
  centerId: string
  name: string
  description: string | null
  color: ClassColor
  createdAt: string
  updatedAt: string
}

const props = defineProps<{
  mode: 'create' | 'edit'
  initialClass?: ClassRecord | null
  hasEnrolledInEnrollingOrUpcoming?: boolean
  nonTerminatedSchedulesCount?: number
  readOnly?: boolean
}>()

const form = reactive<{
  name: string
  color: ClassColor
  description: string
}>({
  name: props.initialClass?.name ?? '',
  color: props.initialClass?.color ?? 'black',
  description: props.initialClass?.description ?? '',
})

watch(
  () => props.initialClass,
  (val) => {
    if (val) {
      form.name = val.name
      form.color = val.color
      form.description = val.description ?? ''
    }
  },
  { immediate: true },
)

const fieldErrors = ref<Record<string, string>>({})
const generalError = ref('')
const successMessage = ref('')
const submitting = ref(false)
const deleting = ref(false)

const showDeleteDialog = ref(false)
const showNotifyUpdateDialog = ref(false)

const nameOrDescriptionChanged = computed(() => {
  if (props.mode !== 'edit' || !props.initialClass) return false
  const nextName = form.name.trim()
  const nextDesc = form.description.trim() || null
  const prevDesc = props.initialClass.description ?? null
  return nextName !== props.initialClass.name || nextDesc !== prevDesc
})

function validateForm(): boolean {
  fieldErrors.value = {}
  generalError.value = ''

  const payload = {
    name: form.name.trim(),
    color: form.color,
    description: form.description.trim() ? form.description.trim() : null,
  }

  const schema = props.mode === 'create' ? createClassSchema : updateClassSchema
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'general')
      if (!fieldErrors.value[key]) {
        fieldErrors.value[key] = issue.message
      }
    }
    return false
  }
  return true
}

async function handleSubmit() {
  if (props.readOnly) return
  if (!validateForm()) return

  // SPECIFICATION.md lines 81-83: If modifying name/description and there are ENROLLING or UPCOMING schedules with enrolled users, prompt manager whether to notify them
  if (
    props.mode === 'edit' &&
    props.hasEnrolledInEnrollingOrUpcoming &&
    nameOrDescriptionChanged.value
  ) {
    showNotifyUpdateDialog.value = true
    return
  }

  await saveClass({ notifyEnrolled: false, notificationMessage: null })
}

async function saveClass(notification: {
  notifyEnrolled: boolean
  notificationMessage: string | null
}) {
  submitting.value = true
  generalError.value = ''
  successMessage.value = ''
  showNotifyUpdateDialog.value = false

  const payload = {
    name: form.name.trim(),
    color: form.color,
    description: form.description.trim() ? form.description.trim() : null,
    ...(props.mode === 'edit'
      ? {
          notifyEnrolled: notification.notifyEnrolled,
          notificationMessage: notification.notificationMessage,
        }
      : {}),
  }

  try {
    if (props.mode === 'create') {
      await $fetch('/api/classes', {
        method: 'POST',
        body: payload,
      })
      await navigateTo('/worker/classes')
    } else if (props.initialClass) {
      const res = await $fetch<{ class: ClassRecord; notifiedCount: number }>(
        `/api/classes/${props.initialClass.id}`,
        {
          method: 'PUT',
          body: payload,
        },
      )
      successMessage.value =
        res.notifiedCount > 0
          ? `Corso aggiornato con successo. Inviata email di avviso a ${res.notifiedCount} iscritti.`
          : 'Corso aggiornato con successo.'
      await navigateTo('/worker/classes')
    }
  } catch (err) {
    generalError.value = extractApiErrorMessage(
      err,
      'Impossibile salvare il corso. Verifica i dati inseriti.',
    )
  } finally {
    submitting.value = false
  }
}

async function confirmDelete() {
  if (!props.initialClass || props.readOnly) return
  deleting.value = true
  generalError.value = ''

  try {
    await $fetch(`/api/classes/${props.initialClass.id}`, {
      method: 'DELETE',
    })
    showDeleteDialog.value = false
    await navigateTo('/worker/classes')
  } catch (err) {
    showDeleteDialog.value = false
    generalError.value = extractApiErrorMessage(
      err,
      'Impossibile eliminare il corso.',
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
          to="/worker/classes"
          class="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          ← Torna alla lista corsi
        </NuxtLink>
        <h1 class="mt-1 text-2xl font-bold text-slate-900">
          {{
            mode === 'create'
              ? 'Nuovo corso'
              : readOnly
                ? 'Dettaglio corso'
                : 'Modifica corso'
          }}
        </h1>
      </div>

      <!-- SPECIFICATION.md line 393: "In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma" -->
      <button
        v-if="mode === 'edit' && !readOnly"
        type="button"
        data-testid="delete-class-btn"
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
        @click="showDeleteDialog = true"
      >
        Elimina corso
      </button>
    </div>

    <div
      v-if="generalError"
      class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      {{ generalError }}
    </div>

    <div
      v-if="successMessage"
      class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
    >
      {{ successMessage }}
    </div>

    <form
      class="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs"
      @submit.prevent="handleSubmit"
    >
      <!-- Nome corso -->
      <div>
        <label for="class-name" class="block text-sm font-semibold text-slate-800">
          Nome del corso <span v-if="!readOnly" class="text-red-600">*</span>
        </label>
        <input
          id="class-name"
          v-model="form.name"
          type="text"
          maxlength="255"
          :disabled="readOnly"
          placeholder="Es. Pilates Matwork, Yoga Vinyasa..."
          class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100 disabled:text-slate-600"
        />
        <p v-if="fieldErrors.name" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.name }}
        </p>
      </div>

      <!-- Colore a calendario -->
      <div>
        <label class="block text-sm font-semibold text-slate-800">
          Colore a calendario <span v-if="!readOnly" class="text-red-600">*</span>
        </label>
        <div class="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <button
            v-for="colorKey in CLASS_COLORS"
            :key="colorKey"
            type="button"
            :disabled="readOnly"
            class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition disabled:cursor-default"
            :class="
              form.color === colorKey
                ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-600/20 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            "
            @click="!readOnly && (form.color = colorKey)"
          >
            <span
              class="h-4 w-4 shrink-0 rounded-full border"
              :class="CLASS_COLOR_STYLES[colorKey].swatchClass"
            />
            <span class="truncate">{{ CLASS_COLOR_STYLES[colorKey].label }}</span>
          </button>
        </div>
        <p v-if="fieldErrors.color" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.color }}
        </p>
      </div>

      <!-- Descrizione facoltativa -->
      <div>
        <label for="class-description" class="block text-sm font-semibold text-slate-800">
          Descrizione <span class="text-xs font-normal text-slate-500">(facoltativa)</span>
        </label>
        <textarea
          id="class-description"
          v-model="form.description"
          rows="4"
          maxlength="1000"
          :disabled="readOnly"
          placeholder="Inserisci una descrizione facoltativa del corso..."
          class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100 disabled:text-slate-600"
        />
        <p v-if="fieldErrors.description" class="mt-1 text-xs font-medium text-red-600">
          {{ fieldErrors.description }}
        </p>
      </div>

      <!-- Actions (hidden for read-only instructors) -->
      <div v-if="!readOnly" class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <NuxtLink
          to="/worker/classes"
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

    <!-- Delete confirmation popup -->
    <ConfirmDialog
      :open="showDeleteDialog"
      title="Elimina corso"
      :description="
        nonTerminatedSchedulesCount && nonTerminatedSchedulesCount > 0
          ? `Attenzione: questo corso ha ${nonTerminatedSchedulesCount} lezioni non terminate (bozza, pubblicate, iscrizioni aperte, in partenza o in corso). Devi prima eliminarle tutte prima di poter eliminare il corso.`
          : `Sei sicuro di voler eliminare il corso «${initialClass?.name ?? ''}»?`
      "
      confirm-label="Elimina"
      variant="danger"
      :loading="deleting"
      @close="showDeleteDialog = false"
      @confirm="confirmDelete"
    />

    <!-- Notify enrolled users when modifying name/description -->
    <ConfirmDialog
      :open="showNotifyUpdateDialog"
      title="Avvisa gli iscritti al corso"
      description="Stai modificando il nome e/o la descrizione di un corso che ha lezioni con iscrizioni aperte o in partenza con clienti iscritti. Vuoi inviare loro un'email di avviso?"
      confirm-label="Salva modifiche"
      variant="primary"
      :loading="submitting"
      :show-notify-option="true"
      notify-label="Invia email di avviso a tutti gli iscritti alle lezioni attive del corso"
      :default-notify="true"
      :show-optional-message="true"
      @close="showNotifyUpdateDialog = false"
      @confirm="saveClass"
    />
  </div>
</template>

