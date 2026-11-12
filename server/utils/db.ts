import type { D1Database } from '@cloudflare/workers-types'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { createError, type H3Event } from 'h3'
import * as schema from '../db/schema'

export type AppDatabase = DrizzleD1Database<typeof schema>

declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      env: {
        DB: D1Database
        AUTH_SECRET?: string
        RESEND_API_KEY?: string
        EMAIL_FROM?: string
        APP_URL?: string
        [key: string]: unknown
      }
    }
  }
}

/**
 * Creates a Drizzle ORM instance bound to a Cloudflare D1 database.
 */
export function createDb(d1: D1Database): AppDatabase {
  return drizzle(d1, { schema })
}

/**
 * Retrieves the Drizzle ORM instance from the current Nuxt/Nitro H3 request event.
 */
export function useDb(event: H3Event): AppDatabase {
  const d1 = event.context.cloudflare?.env?.DB
  if (!d1) {
    throw createError({
      statusCode: 500,
      message: "Database D1 non configurato nell'ambiente Cloudflare.",
    })
  }
  return createDb(d1)
}

