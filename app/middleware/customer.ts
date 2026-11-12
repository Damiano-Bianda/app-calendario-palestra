export default defineNuxtRouteMiddleware(async () => {
  const { authState, initialized, fetchMe, setMode } = useAuth()

  if (!initialized.value || !authState.value) {
    await fetchMe()
  }

  if (!authState.value) {
    return navigateTo('/login')
  }

  setMode('customer')
})

