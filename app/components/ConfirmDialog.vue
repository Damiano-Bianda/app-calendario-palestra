<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'danger' | 'primary'
    loading?: boolean
    showNotifyOption?: boolean
    notifyLabel?: string
    defaultNotify?: boolean
    showOptionalMessage?: boolean
    messagePlaceholder?: string
  }>(),
  {
    description: '',
    confirmLabel: 'Conferma',
    cancelLabel: 'Annulla',
    variant: 'danger',
    loading: false,
    showNotifyOption: false,
    notifyLabel: 'Invia email di avviso agli iscritti',
    defaultNotify: true,
    showOptionalMessage: false,
    messagePlaceholder: 'Messaggio facoltativo da includere nella email...',
  },
)

const emit = defineEmits<{
  (e: 'close'): void
  (
    e: 'confirm',
    payload: {
      notifyEnrolled: boolean
      notificationMessage: string | null
    },
  ): void
}>()

const notifyEnrolled = ref(props.defaultNotify)
const notificationMessage = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      notifyEnrolled.value = props.defaultNotify
      notificationMessage.value = ''
    }
  },
)

function handleConfirm() {
  const trimmed = notificationMessage.value.trim()
  emit('confirm', {
    notifyEnrolled: props.showNotifyOption ? notifyEnrolled.value : false,
    notificationMessage: trimmed.length > 0 ? trimmed : null,
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'confirm-dialog-title'"
      @click.self="!loading && emit('close')"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
        <h3 id="confirm-dialog-title" class="text-lg font-semibold text-slate-900">
          {{ title }}
        </h3>
        <p v-if="description" class="mt-2 text-sm text-slate-600">
          {{ description }}
        </p>

        <div v-if="showNotifyOption" class="mt-4 space-y-3 rounded-lg bg-slate-50 p-3.5 border border-slate-200">
          <label class="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-slate-800">
            <input
              v-model="notifyEnrolled"
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>{{ notifyLabel }}</span>
          </label>

          <div v-if="notifyEnrolled && showOptionalMessage">
            <label class="block text-xs font-medium text-slate-700 mb-1">
              Messaggio facoltativo
            </label>
            <textarea
              v-model="notificationMessage"
              rows="3"
              maxlength="2000"
              :placeholder="messagePlaceholder"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        <div class="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            :disabled="loading"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            @click="emit('close')"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            :disabled="loading"
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-xs disabled:opacity-50"
            :class="
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            "
            @click="handleConfirm"
          >
            {{ loading ? 'Operazione in corso...' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

