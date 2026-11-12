<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()
const {
  activeCenter,
  user,
  isWorker,
  roleLabel,
  toggleMode,
  logout,
} = useAuth()

interface NavItem {
  key: string
  label: string
  to: string
  matchPrefix?: string
}

const navItems = computed<NavItem[]>(() => [
  {
    key: 'lessons',
    label: 'Lezioni',
    to: '/customer',
  },
  {
    key: 'summary',
    label: 'Riepilogo',
    to: '/customer/summary',
    matchPrefix: '/customer/summary',
  },
  {
    key: 'settings',
    label: 'Impostazioni',
    to: '/settings',
    matchPrefix: '/settings',
  },
])

function isItemActive(item: NavItem): boolean {
  const path = route.path.replace(/\/+$/, '') || '/'
  if (item.to === '/customer') {
    return path === '/customer'
  }
  return item.matchPrefix ? path.startsWith(item.matchPrefix) : path === item.to
}
</script>

<template>
  <!-- Mobile Top Header: Mode toggle button on top-right of screen ONLY if user is also a worker (SPECIFICATION.md line 389) -->
  <header
    class="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-2xs md:hidden"
  >
    <div class="min-w-0">
      <p class="truncate text-sm font-bold text-slate-900">
        {{ activeCenter?.centerName ?? 'Palestra' }}
      </p>
      <p class="truncate text-xs text-slate-500">
        {{ user ? `${user.name} ${user.surname}` : 'Area Cliente' }}
      </p>
    </div>

    <div v-if="isWorker" class="flex items-center gap-2">
      <button
        type="button"
        data-testid="mobile-customer-mode-toggle"
        class="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
        title="Passa a modalità lavoratore"
        @click="toggleMode"
      >
        <span>Modalità: Cliente</span>
        <span class="text-indigo-500">⇄ Lavoratore</span>
      </button>
    </div>
  </header>

  <!-- Desktop Left Vertical Sidebar (SPECIFICATION.md line 389) -->
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
        <span class="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
          Area Cliente
        </span>
        <span
          v-if="isWorker"
          class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
        >
          {{ roleLabel }}
        </span>
      </div>

      <!-- Toggle button: Customer mode <-> Worker mode (only shown if customer is also a worker) -->
      <button
        v-if="isWorker"
        type="button"
        data-testid="desktop-customer-mode-toggle"
        class="mt-3 flex w-full items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
        @click="toggleMode"
      >
        <span>Modalità Cliente</span>
        <span class="rounded bg-white px-1.5 py-0.5 text-[11px] text-indigo-600 shadow-2xs">
          Passa a Lavoratore ⇄
        </span>
      </button>
    </div>

    <nav class="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Navigazione cliente">
      <NuxtLink
        v-for="item in navItems"
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
        data-testid="desktop-customer-logout-btn"
        class="flex w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
        @click="logout"
      >
        Logout
      </button>
    </div>
  </aside>

  <!-- Mobile Bottom Horizontal Navbar (SPECIFICATION.md line 389) -->
  <nav
    class="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around gap-1 overflow-x-auto border-t border-slate-200 bg-white px-2 py-1.5 shadow-lg md:hidden"
    aria-label="Navigazione mobile cliente"
  >
    <NuxtLink
      v-for="item in navItems"
      :key="item.key"
      :to="item.to"
      class="flex shrink-0 flex-col items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition"
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
      data-testid="mobile-customer-logout-btn"
      class="flex shrink-0 flex-col items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      @click="logout"
    >
      <span>Logout</span>
    </button>
  </nav>
</template>

