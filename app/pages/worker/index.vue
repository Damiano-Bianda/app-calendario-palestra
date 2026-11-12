<script setup lang="ts">
definePageMeta({
  layout: 'worker',
  middleware: ['worker'],
})

const { activeCenter, canWrite } = useAuth()

const dashboardActions = [
  {
    key: 'create-class',
    title: 'Crea corso',
    description: 'Configura un nuovo corso con nome, colore a calendario e descrizione.',
    to: '/worker/classes/new',
    accentClass: 'border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/80 text-indigo-950',
    badgeClass: 'bg-indigo-600 text-white',
    symbol: '+',
  },
  {
    key: 'create-schedule',
    title: 'Crea lezione',
    description: 'Pianifica lezioni ricorrenti settimanali a calendario con orari e capienza.',
    to: '/worker/schedules/new',
    accentClass: 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-950',
    badgeClass: 'bg-emerald-600 text-white',
    symbol: '+',
  },
  {
    key: 'create-subscription',
    title: 'Crea abbonamento',
    description: 'Definisci un nuovo template di abbonamento a entrate o illimitato per i corsi.',
    to: '/worker/subscriptions/new',
    accentClass: 'border-amber-200 bg-amber-50/70 hover:bg-amber-100/80 text-amber-950',
    badgeClass: 'bg-amber-600 text-white',
    symbol: '+',
  },
  {
    key: 'create-user',
    title: 'Crea cliente',
    description: 'Registra o abilita un nuovo cliente o collaboratore nella sede corrente.',
    to: '/worker/users/new',
    accentClass: 'border-sky-200 bg-sky-50/70 hover:bg-sky-100/80 text-sky-950',
    badgeClass: 'bg-sky-600 text-white',
    symbol: '+',
  },
]
</script>

<template>
  <div class="mx-auto max-w-4xl py-4 sm:py-8">
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Dashboard Lavoratore
      </h1>
      <p class="mt-2 text-sm text-slate-600">
        Sede attiva:
        <span class="font-semibold text-slate-800">{{ activeCenter?.centerName }}</span>
        ({{ activeCenter?.timezone }})
      </p>
    </div>

    <div
      v-if="canWrite"
      class="grid grid-cols-1 gap-5 sm:grid-cols-2"
    >
      <NuxtLink
        v-for="action in dashboardActions"
        :key="action.key"
        :to="action.to"
        class="group flex min-h-44 flex-col justify-between rounded-2xl border-2 p-6 shadow-xs transition duration-150 hover:-translate-y-0.5 hover:shadow-md"
        :class="action.accentClass"
      >
        <div class="flex items-center justify-between">
          <span class="text-xl font-bold">{{ action.title }}</span>
          <span
            class="flex h-10 w-10 items-center justify-center rounded-xl text-xl font-bold shadow-xs transition group-hover:scale-105"
            :class="action.badgeClass"
          >
            {{ action.symbol }}
          </span>
        </div>
        <p class="mt-4 text-sm opacity-85">
          {{ action.description }}
        </p>
      </NuxtLink>
    </div>
  </div>
</template>

