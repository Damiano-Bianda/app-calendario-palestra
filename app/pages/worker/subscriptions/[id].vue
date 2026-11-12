<script setup lang="ts">
import WorkerSubscriptionForm, {
  type SubscriptionClassItem,
  type SubscriptionRecord,
} from '~/components/worker/SubscriptionForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const route = useRoute()
const { canWrite } = useAuth()
const subscriptionId = String(route.params.id ?? '')

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const [{ data: subData, error }, { data: classesData }] = await Promise.all([
  useAsyncData(`worker-subscription-${subscriptionId}`, () =>
    $fetch<{ subscription: SubscriptionRecord }>(`/api/subscriptions/${subscriptionId}`, {
      headers,
    }),
  ),
  useAsyncData('worker-subscription-edit-classes', () =>
    $fetch<{ classes: SubscriptionClassItem[] }>('/api/classes', { headers }),
  ),
])
</script>

<template>
  <div>
    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Abbonamento non trovato o non accessibile.
    </div>

    <WorkerSubscriptionForm
      v-else-if="subData?.subscription"
      mode="edit"
      :initial-subscription="subData.subscription"
      :classes-options="classesData?.classes ?? []"
      :read-only="!canWrite"
    />
  </div>
</template>

