<script setup lang="ts">
import WorkerClassForm, { type ClassRecord } from '~/components/worker/ClassForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const route = useRoute()
const { canWrite } = useAuth()
const classId = String(route.params.id ?? '')

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, error } = await useAsyncData(`worker-class-${classId}`, () =>
  $fetch<{
    class: ClassRecord
    meta: {
      hasEnrolledInEnrollingOrUpcoming: boolean
      nonTerminatedSchedulesCount: number
    }
  }>(`/api/classes/${classId}`, { headers }),
)
</script>

<template>
  <div>
    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Corso non trovato o non accessibile.
    </div>

    <WorkerClassForm
      v-else-if="data?.class"
      mode="edit"
      :initial-class="data.class"
      :has-enrolled-in-enrolling-or-upcoming="data.meta.hasEnrolledInEnrollingOrUpcoming"
      :non-terminated-schedules-count="data.meta.nonTerminatedSchedulesCount"
      :read-only="!canWrite"
    />
  </div>
</template>

