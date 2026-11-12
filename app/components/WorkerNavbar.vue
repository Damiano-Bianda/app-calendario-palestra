<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()
const {
  activeCenter,
  user,
  canWrite,
  roleLabel,
  toggleMode,
  logout,
} = useAuth()

interface NavItem {
  key: string
  label: string
  to: string
  matchPrefix?: string
  show: boolean
}

const navItems = computed<NavItem[]>(() => [
  {
    key: 'dashboard',
    label: 'Dashboard',
    to: '/worker',
    // SPECIFICATION.md line 386: "Per gli istruttori non compare il pulsante Dashboard"
    show: canWrite.value,
  },
  {
    key: 'calendar',
    label: 'Calendario',
    to: '/worker/calendar',
    matchPrefix: '/worker/calendar',
    show: true,
  },
  {
    key: 'users',
    label: 'Clienti',
    to: '/worker/users',
    matchPrefix: '/worker/users',
    show: true,
  },
  {
    key: 'classes',
    label: 'Corsi',
    to: '/worker/classes',
    matchPrefix: '/worker/classes',
    show: true,
  },
  {
    key: 'schedules',
    label: 'Lezioni',
    to: '/worker/schedules',
    matchPrefix: '/worker/schedules',
    show: true,
  },
  {
    key: 'subscriptions',
    label: 'Abbonamenti',
    to: '/worker/subscriptions',
    matchPrefix: '/worker/subscriptions',
    show: true,
  },
  {
    key: 'user-subscriptions',
    label: 'Sottoscrizioni',
    to: '/worker/user-subscriptions',
    matchPrefix: '/worker/user-subscriptions',
    show: true,
  },
  {
    key: 'settings',
    label: 'Impostazioni',
    to: '/settings',
    matchPrefix: '/settings',
    show: true,
  },
])

const visibleNavItems = computed(() => navItems.value.filter((item) => item.show))

function isItemActive(item: NavItem): boolean {
  const path = route.path.replace(/\/+$/, '') || '/'
  if (item.to === '/worker') {
    return path === '/worker'
  }
  return item.matchPrefix ? path.startsWith(item.matchPrefix) : path === item.to
}
</script>

<template>
  <!-- Mobile Top Header: Mode toggle button on top-right of screen (SPECIFICATION.md line 387) -->
  <header
    class="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-2xs md:hidden"
  >
    <div class="min-w-0">
      <p class="truncate text-sm font-bold text-slate-900">
        {{ activeCenter?.centerName ?? 'Palestra' }}
      </p>
      <p class="truncate text-xs text-slate-500">
        {{ roleLabel }}
        <span v-if="!canWrite" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
          Sola lettura
        </span>
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        data-testid="mobile-mode-toggle"
        class="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
        title="Passa a modalità cliente"
        @click="toggleMode"
      >
        <span>Modalità: Lavoratore</span>
        <span class="text-indigo-500">⇄ Cliente</span>
      </button>
    </div>
  </header>

  <!-- Desktop Left Vertical Sidebar (SPECIFICATION.md line 387) -->
  <aside
    class="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-64 md:flex-col md:border-r md:border-slate-200 md:bg-white"
  >
    <div class="border-b border-slate-200 p-4">
      <div class="flex items-center justify-between gap-2">
        <h1 class="truncate text-base font-bold text-slate-900">
          {{ activeCenter?.centerName ?? 'Calendario Palestra' }}
        </h1>
      </div>
      <p class="mt-0.5 truncate text-xs text-slate-500">
        {{ user ? `${user.name} ${user.surname}` : '' }}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {{ roleLabel }}
        </span>
        <span
          v-if="!canWrite"
          class="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
        >
          Sola lettura
        </span>
      </div>

      <!-- Toggle button: Worker mode <-> Customer mode -->
      <button
        type="button"
        data-testid="desktop-mode-toggle"
        class="mt-3 flex w-full items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
        @click="toggleMode"
      >
        <span>Modalità Lavoratore</span>
        <span class="rounded bg-white px-1.5 py-0.5 text-[11px] text-indigo-600 shadow-2xs">
          Passa a Cliente ⇄
        </span>
      </button>
    </div>

    <nav class="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Navigazione lavoratore">
      <NuxtLink
        v-for="item in visibleNavItems"
        :key="item.key"
        :to="item.to"
        class="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition"
        :class="
          isItemActive(item)
            ? 'bg-indigo-600 text-white shadow-2xs'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        "
      >
        {{ item.label }}
      </NuxtLink>
    </nav>

    <div class="border-t border-slate-200 p-3">
      <button
        type="button"
        data-testid="desktop-logout-btn"
        class="flex w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
        @click="logout"
      >
        Logout
      </button>
    </div>
  </aside>

  <!-- Mobile Bottom Horizontal Navbar (SPECIFICATION.md line 387) -->
  <nav
    class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-1 overflow-x-auto border-t border-slate-200 bg-white px-2 py-1.5 shadow-lg md:hidden"
    aria-label="Navigazione mobile lavoratore"
  >
    <NuxtLink
      v-for="item in visibleNavItems"
      :key="item.key"
      :to="item.to"
      class="flex shrink-0 flex-col items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition"
      :class="
        isItemActive(item)
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      "
    >
      <span>{{ item.label }}</span>
    </NuxtLink>

    <button
      type="button"
      data-testid="mobile-logout-btn"
      class="flex shrink-0 flex-col items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      @click="logout"
    >
      <span>Logout</span>
    </button>
  </nav>
</template>

