<script setup lang="ts">
import WorkerSubscriptionForm, {
  type SubscriptionClassItem,
} from '~/components/worker/SubscriptionForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite } = useAuth()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: classesData } = await useAsyncData('worker-subscription-new-classes', () =>
  $fetch<{ classes: SubscriptionClassItem[] }>('/api/classes', { headers }),
)
</script>

<template>
  <WorkerSubscriptionForm
    mode="create"
    :classes-options="classesData?.classes ?? []"
    :read-only="!canWrite"
  />
</template>

