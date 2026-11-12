<script setup lang="ts">
const { authState, initialized, fetchMe } = useAuth()

if (!initialized.value || !authState.value) {
  await fetchMe()
}

if (!authState.value) {
  await navigateTo('/login', { replace: true })
} else {
  await navigateTo(authState.value.defaultRedirect || '/worker', { replace: true })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6 text-sm text-slate-500">
    Reindirizzamento in corso...
  </div>
</template>

