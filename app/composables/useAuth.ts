import { computed } from 'vue'

export interface CenterMembership {
  centerId: string
  centerName: string
  timezone: string
  name: string
  surname: string
  phoneNumber: string
  isManager: boolean
  isAssistantManager: boolean
  isInstructor: boolean
  isWorker: boolean
  defaultMode: 'worker' | 'customer'
  defaultRedirect: '/worker' | '/worker/calendar' | '/customer'
}

export interface AuthMeResponse {
  user: {
    id: string
    email: string
    name: string
    surname: string
    phoneNumber: string
  }
  activeCenterId: string
  activeCenter: CenterMembership
  roles: {
    isManager: boolean
    isAssistantManager: boolean
    isInstructor: boolean
  }
  defaultMode: 'worker' | 'customer'
  defaultRedirect: '/worker' | '/worker/calendar' | '/customer'
  centers: CenterMembership[]
}

export function useAuth() {
  const authState = useState<AuthMeResponse | null>('auth_me_state', () => null)
  const initialized = useState<boolean>('auth_me_initialized', () => false)
  const loading = useState<boolean>('auth_me_loading', () => false)
  const currentMode = useState<'worker' | 'customer'>('app_ui_mode', () => 'worker')

  const user = computed(() => authState.value?.user ?? null)
  const activeCenter = computed(() => authState.value?.activeCenter ?? null)
  const activeCenterId = computed(() => authState.value?.activeCenterId ?? '')
  const centerTimezone = computed(() => authState.value?.activeCenter?.timezone || 'Europe/Rome')
  const centers = computed(() => authState.value?.centers ?? [])

  const isManager = computed(() => Boolean(authState.value?.roles?.isManager))
  const isAssistantManager = computed(() => Boolean(authState.value?.roles?.isAssistantManager))
  const isInstructor = computed(() => Boolean(authState.value?.roles?.isInstructor))

  const isWorker = computed(
    () => isManager.value || isAssistantManager.value || isInstructor.value,
  )

  /**
   * Manager and Assistant Manager can create, edit, and delete resources.
   * Instructors who are neither manager nor assistant manager have read-only access.
   */
  const canWrite = computed(() => isManager.value || isAssistantManager.value)

  /**
   * True when the user is an instructor in the active center without manager/assistant manager roles.
   */
  const isInstructorOnly = computed(
    () => isInstructor.value && !isManager.value && !isAssistantManager.value,
  )

  const workerHomeRoute = computed<'/worker' | '/worker/calendar'>(() =>
    canWrite.value ? '/worker' : '/worker/calendar',
  )

  const roleLabel = computed(() => {
    const labels: string[] = []
    if (isManager.value) labels.push('Gerente')
    if (isAssistantManager.value) labels.push('Vice gerente')
    if (isInstructor.value) labels.push('Istruttore')
    return labels.length > 0 ? labels.join(' • ') : 'Cliente'
  })

  function setAuthData(data: AuthMeResponse | null) {
    authState.value = data
    initialized.value = true
    if (data) {
      currentMode.value = data.defaultMode
    }
  }

  async function fetchMe(force = false): Promise<AuthMeResponse | null> {
    if (initialized.value && !force && authState.value) {
      return authState.value
    }
    loading.value = true
    try {
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      const data = await $fetch<AuthMeResponse>('/api/auth/me', {
        headers,
      })
      authState.value = data
      initialized.value = true
      if (!isWorker.value) {
        currentMode.value = 'customer'
      }
      return data
    } catch {
      authState.value = null
      initialized.value = true
      return null
    } finally {
      loading.value = false
    }
  }

  async function toggleMode() {
    if (!isWorker.value) {
      currentMode.value = 'customer'
      await navigateTo('/customer')
      return
    }
    if (currentMode.value === 'worker') {
      currentMode.value = 'customer'
      await navigateTo('/customer')
    } else {
      currentMode.value = 'worker'
      await navigateTo(workerHomeRoute.value)
    }
  }

  function setMode(mode: 'worker' | 'customer') {
    currentMode.value = mode
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Ignore errors on logout
    } finally {
      authState.value = null
      initialized.value = false
      await navigateTo('/login')
    }
  }

  return {
    authState,
    initialized,
    loading,
    currentMode,
    user,
    activeCenter,
    activeCenterId,
    centerTimezone,
    centers,
    isManager,
    isAssistantManager,
    isInstructor,
    isWorker,
    canWrite,
    isInstructorOnly,
    workerHomeRoute,
    roleLabel,
    setAuthData,
    fetchMe,
    toggleMode,
    setMode,
    logout,
  }
}

