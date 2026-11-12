<script setup lang="ts">
import WorkerClassForm from '~/components/worker/ClassForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite } = useAuth()
</script>

<template>
  <WorkerClassForm mode="create" :read-only="!canWrite" />
</template>

