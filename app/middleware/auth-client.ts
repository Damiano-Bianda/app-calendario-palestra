export default defineNuxtRouteMiddleware(async () => {
  const { authState, initialized, fetchMe, isWorker, setMode } = useAuth()

  if (!initialized.value || !authState.value) {
    await fetchMe()
  }

  if (!authState.value) {
    return navigateTo('/login')
  }

  if (!isWorker.value) {
    setMode('customer')
  }
})

