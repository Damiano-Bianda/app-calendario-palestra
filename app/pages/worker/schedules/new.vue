<script setup lang="ts">
import WorkerScheduleForm, {
  type SimpleClassOption,
  type SimpleUserOption,
} from '~/components/worker/ScheduleForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const route = useRoute()
const { canWrite } = useAuth()

const prefillDate = typeof route.query.date === 'string' ? route.query.date : undefined
const prefillTime = typeof route.query.time === 'string' ? route.query.time : undefined

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const [{ data: classesData }, { data: usersData }] = await Promise.all([
  useAsyncData('worker-schedule-new-classes', () =>
    $fetch<{ classes: SimpleClassOption[] }>('/api/classes', { headers }),
  ),
  useAsyncData('worker-schedule-new-users', () =>
    $fetch<{ users: SimpleUserOption[] }>('/api/users', { headers }),
  ),
])
</script>

<template>
  <WorkerScheduleForm
    mode="create"
    :classes-options="classesData?.classes ?? []"
    :users-options="usersData?.users ?? []"
    :prefill-date="prefillDate"
    :prefill-time="prefillTime"
    :read-only="!canWrite"
  />
</template>

