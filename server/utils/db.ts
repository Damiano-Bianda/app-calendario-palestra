import type { D1Database } from '@cloudflare/workers-types'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { createError, type H3Event } from 'h3'
import * as schema from '../db/schema.ts'

export type AppDatabase = DrizzleD1Database<typeof schema>

export interface CloudflareEnv {
  DB?: D1Database
  AUTH_SECRET?: string
  RESEND_API_KEY?: string
  BREVO_API_KEY?: string
  EMAIL_FROM?: string
  APP_URL?: string
  [key: string]: unknown
}

declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      env: CloudflareEnv & { DB: D1Database }
    }
  }
}

/**
 * Resolves the active Cloudflare environment bindings from the H3 request context
 * or Nitro's global `__env__` fallback (used during SSR internal `localFetch` calls).
 */
export function getCloudflareEnv(event?: H3Event): CloudflareEnv | undefined {
  if (event?.context?.cloudflare?.env) {
    return event.context.cloudflare.env
  }
  const globalEnv = (globalThis as { __env__?: CloudflareEnv }).__env__
  return globalEnv
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
  const d1 = getCloudflareEnv(event)?.DB
  if (!d1) {
    throw createError({
      statusCode: 500,
      message: "Database D1 non configurato nell'ambiente Cloudflare.",
    })
  }
  return createDb(d1)
}

