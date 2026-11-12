<template>
  <div class="min-h-screen bg-slate-50">
    <CustomerNavbar />

    <div class="pb-20 md:pl-64 md:pb-8">
      <main class="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>

