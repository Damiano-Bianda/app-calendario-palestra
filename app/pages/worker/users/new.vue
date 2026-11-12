<script setup lang="ts">
import WorkerUserForm from '~/components/worker/UserForm.vue'

definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { canWrite } = useAuth()
</script>

<template>
  <WorkerUserForm mode="create" :read-only="!canWrite" />
</template>

