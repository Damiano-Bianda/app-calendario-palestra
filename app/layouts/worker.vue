<script setup lang="ts">
const { canWrite, isInstructorOnly } = useAuth()
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <WorkerNavbar />

    <div class="pb-20 md:pl-64 md:pb-8">
      <!-- Read-only banner for Instructors -->
      <div
        v-if="isInstructorOnly && !canWrite"
        class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 sm:px-6"
      >
        Accesso Istruttore: visualizzazione in sola lettura. Puoi consultare tutti i dati e contattare via email gli iscritti alle tue lezioni.
      </div>

      <main class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>

