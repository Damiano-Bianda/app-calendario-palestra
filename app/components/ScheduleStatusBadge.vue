<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleStatus } from '../../shared/utils/schedule-status'
import { getScheduleStatusStyle } from '~/utils/ui-formatters'

const props = defineProps<{
  status: ScheduleStatus
}>()

const style = computed(() => getScheduleStatusStyle(props.status))
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
    :class="style.badgeClass"
  >
    {{ style.label }}
  </span>
</template>

