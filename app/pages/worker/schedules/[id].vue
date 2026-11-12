<script setup lang="ts">
import type { EnrichedScheduleResponse } from '../../../../server/utils/domain-queries'
import WorkerScheduleForm, {
  type ParticipantRecord,
  type SimpleClassOption,
  type SimpleUserOption,
} from '~/components/worker/ScheduleForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const route = useRoute()
const { canWrite } = useAuth()
const scheduleId = String(route.params.id ?? '')

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const [{ data: scheduleData, error, refresh }, { data: classesData }, { data: usersData }] =
  await Promise.all([
    useAsyncData(`worker-schedule-detail-${scheduleId}`, () =>
      $fetch<{
        schedule: EnrichedScheduleResponse
        enrolledUsers: ParticipantRecord[]
        queuedUsers: ParticipantRecord[]
      }>(`/api/schedules/${scheduleId}`, { headers }),
    ),
    useAsyncData('worker-schedule-edit-classes', () =>
      $fetch<{ classes: SimpleClassOption[] }>('/api/classes', { headers }),
    ),
    useAsyncData('worker-schedule-edit-users', () =>
      $fetch<{ users: SimpleUserOption[] }>('/api/users', { headers }),
    ),
  ])
</script>

<template>
  <div>
    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Lezione non trovata o non accessibile.
    </div>

    <WorkerScheduleForm
      v-else-if="scheduleData?.schedule"
      mode="edit"
      :initial-schedule="scheduleData.schedule"
      :enrolled-users="scheduleData.enrolledUsers"
      :queued-users="scheduleData.queuedUsers"
      :classes-options="classesData?.classes ?? []"
      :users-options="usersData?.users ?? []"
      :read-only="!canWrite"
      @refresh="refresh"
    />
  </div>
</template>

