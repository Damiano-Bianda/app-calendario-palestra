<script setup lang="ts">
import type { SubscriptionRecord } from '~/components/worker/SubscriptionForm.vue'
import WorkerUserForm, {
  type UserSubscriptionDetailItem,
  type WorkerUserRecord,
} from '~/components/worker/UserForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const route = useRoute()
const { canWrite } = useAuth()
const userId = String(route.params.id ?? '')

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const [{ data: userData, error, refresh }, { data: subsData }] = await Promise.all([
  useAsyncData(`worker-user-detail-${userId}`, () =>
    $fetch<{
      user: WorkerUserRecord
      subscriptions: UserSubscriptionDetailItem[]
    }>(`/api/users/${userId}`, { headers }),
  ),
  useAsyncData('worker-user-subscription-templates', () =>
    $fetch<{ subscriptions: SubscriptionRecord[] }>('/api/subscriptions', { headers }),
  ),
])
</script>

<template>
  <div>
    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Utente non trovato o non accessibile nella sede attiva.
    </div>

    <WorkerUserForm
      v-else-if="userData?.user"
      mode="edit"
      :initial-user="userData.user"
      :user-subscriptions="userData.subscriptions"
      :subscription-templates="subsData?.subscriptions ?? []"
      :read-only="!canWrite"
      @refresh="refresh"
    />
  </div>
</template>

