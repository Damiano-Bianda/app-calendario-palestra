export default defineNuxtRouteMiddleware(async (to) => {
  const { authState, initialized, fetchMe, isWorker, isInstructorOnly, setMode } = useAuth()

  if (!initialized.value || !authState.value) {
    await fetchMe()
  }

  if (!authState.value) {
    return navigateTo('/login')
  }

  if (!isWorker.value) {
    setMode('customer')
    return navigateTo('/customer')
  }

  setMode('worker')

  // Instructor read-only guards (SPECIFICATION.md lines 386, 392-402, 404):
  // 1) Dashboard (/worker) is not shown to instructors; their default worker page is /worker/calendar.
  const normalizedPath = to.path.replace(/\/+$/, '') || '/'
  if (isInstructorOnly.value && normalizedPath === '/worker') {
    return navigateTo('/worker/calendar')
  }

  // 2) Instructors are strictly read-only and cannot access creation routes (/worker/*/new).
  if (isInstructorOnly.value && normalizedPath.endsWith('/new')) {
    const parentListPath = normalizedPath.replace(/\/new$/, '')
    return navigateTo(parentListPath || '/worker/calendar')
  }
})

