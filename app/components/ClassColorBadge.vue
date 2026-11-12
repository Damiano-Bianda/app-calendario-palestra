<script setup lang="ts">
import { computed } from 'vue'
import { getClassColorStyle } from '~/utils/ui-formatters'

const props = defineProps<{
  color?: string | null
  showLabel?: boolean
}>()

const style = computed(() => getClassColorStyle(props.color))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
    :class="style.badgeClass"
  >
    <span class="h-2.5 w-2.5 rounded-full border" :class="style.swatchClass" />
    <span v-if="showLabel !== false">{{ style.label }}</span>
  </span>
</template>

