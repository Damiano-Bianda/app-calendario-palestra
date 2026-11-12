// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  nitro: {
    preset: 'cloudflare-module',
    cloudflareDev: {
      configPath: 'wrangler.jsonc',
      persistDir: '.wrangler/state/v3',
    },
  },
  dir: {
    shared: 'shared_unused',
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'it',
      },
      title: 'Calendario Palestra',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
    },
  },
})
