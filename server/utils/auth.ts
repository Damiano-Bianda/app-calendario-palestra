import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  createError,
  deleteCookie,
  getCookie,
  getRequestURL,
  getRouterParam,
  readBody,
  setCookie,
  type H3Event,
} from 'h3'
import type { z } from 'zod'
import { uuidSchema } from '../../shared/schemas/common.ts'
import { centers, users, usersCenters } from '../db/schema.ts'
import { createSessionToken, verifySessionToken } from './crypto.ts'
import { getCloudflareEnv, useDb, type AppDatabase } from './db.ts'

export const SESSION_COOKIE_NAME = 'palestra_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400 // 400 days (maximum browser cookie lifetime)

const DEFAULT_DEV_SECRET = 'dev-palestra-secret-change-in-production-2026-cloudflare'

export interface UserCenterMembershipInfo {
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

export interface AuthContext {
  userId: string
  email: string
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

declare module 'h3' {
  interface H3EventContext {
    auth?: AuthContext
    sessionUserId?: string
  }
}

/**
 * Computes worker status, default mode ('worker' | 'customer'), and default redirect route
 * according to SPECIFICATION.md.
 */
export function computeRoleNavigation(roles: {
  isManager: boolean
  isAssistantManager: boolean
  isInstructor: boolean
}): {
  isWorker: boolean
  defaultMode: 'worker' | 'customer'
  defaultRedirect: '/worker' | '/worker/calendar' | '/customer'
} {
  const isWorker = Boolean(roles.isManager || roles.isAssistantManager || roles.isInstructor)
  if (roles.isManager || roles.isAssistantManager) {
    return {
      isWorker: true,
      defaultMode: 'worker',
      defaultRedirect: '/worker',
    }
  }
  if (roles.isInstructor) {
    return {
      isWorker: true,
      defaultMode: 'worker',
      defaultRedirect: '/worker/calendar',
    }
  }
  return {
    isWorker,
    defaultMode: 'customer',
    defaultRedirect: '/customer',
  }
}

/**
 * Resolves the server HMAC secret from Cloudflare env or process.env.
 */
export function useAuthSecret(event: H3Event): string {
  const cfSecret = getCloudflareEnv(event)?.AUTH_SECRET
  if (typeof cfSecret === 'string' && cfSecret.trim().length > 0) {
    return cfSecret.trim()
  }
  if (typeof process !== 'undefined' && process.env?.AUTH_SECRET?.trim()) {
    return process.env.AUTH_SECRET.trim()
  }
  return DEFAULT_DEV_SECRET
}

/**
 * Resolves the base application URL for password recovery links.
 */
export function useAppUrl(event: H3Event): string {
  const cfAppUrl = getCloudflareEnv(event)?.APP_URL
  if (typeof cfAppUrl === 'string' && cfAppUrl.trim().length > 0) {
    return cfAppUrl.trim().replace(/\/+$/g, '')
  }
  if (typeof process !== 'undefined' && process.env?.APP_URL?.trim()) {
    return process.env.APP_URL.trim().replace(/\/+$/g, '')
  }
  try {
    const reqUrl = getRequestURL(event)
    return `${reqUrl.protocol}//${reqUrl.host}`
  } catch {
    return 'http://localhost:3000'
  }
}

/**
 * Signs and sets the long-lived HTTP-only session cookie containing `user_id` and `center_id`.
 */
export async function setAuthSessionCookie(
  event: H3Event,
  params: { userId: string; centerId: string },
): Promise<string> {
  const secret = useAuthSecret(event)
  const token = await createSessionToken(params, secret)
  const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'

  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isProd,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return token
}

/**
 * Clears the HTTP-only session cookie.
 */
export function clearAuthSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

/**
 * Queries all active centers (`users_centers.deleted_at IS NULL` and `centers.deleted_at IS NULL`)
 * for a given user.
 */
export async function getActiveUserCenters(
  db: AppDatabase,
  userId: string,
): Promise<UserCenterMembershipInfo[]> {
  const rows = await db
    .select({
      centerId: centers.id,
      centerName: centers.name,
      timezone: centers.timezone,
      name: usersCenters.name,
      surname: usersCenters.surname,
      phoneNumber: usersCenters.phoneNumber,
      isManager: usersCenters.isManager,
      isAssistantManager: usersCenters.isAssistantManager,
      isInstructor: usersCenters.isInstructor,
    })
    .from(usersCenters)
    .innerJoin(centers, eq(usersCenters.centerId, centers.id))
    .where(
      and(
        eq(usersCenters.userId, userId),
        isNull(usersCenters.deletedAt),
        isNull(centers.deletedAt),
      ),
    )
    .orderBy(asc(usersCenters.createdAt), asc(centers.name))

  return rows.map((row) => {
    const nav = computeRoleNavigation({
      isManager: row.isManager,
      isAssistantManager: row.isAssistantManager,
      isInstructor: row.isInstructor,
    })
    return {
      ...row,
      ...nav,
    }
  })
}

/**
 * Verifies the session cookie and resolves the active user + active center membership from D1.
 */
export async function authenticateRequest(event: H3Event): Promise<AuthContext> {
  const token = getCookie(event, SESSION_COOKIE_NAME)
  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Autenticazione richiesta.',
    })
  }

  const secret = useAuthSecret(event)
  const session = await verifySessionToken(token, secret)
  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Sessione non valida o scaduta.',
    })
  }

  const db = useDb(event)

  // 1. Verify active user in `users` (deleted_at IS NULL)
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, session.userId), isNull(users.deletedAt)),
  })

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Utente non trovato o disattivato.',
    })
  }

  event.context.sessionUserId = user.id

  // 2. Verify active membership in `users_centers` (deleted_at IS NULL) and active `centers` (deleted_at IS NULL)
  const membershipRows = await db
    .select({
      centerId: centers.id,
      centerName: centers.name,
      timezone: centers.timezone,
      name: usersCenters.name,
      surname: usersCenters.surname,
      phoneNumber: usersCenters.phoneNumber,
      isManager: usersCenters.isManager,
      isAssistantManager: usersCenters.isAssistantManager,
      isInstructor: usersCenters.isInstructor,
    })
    .from(usersCenters)
    .innerJoin(centers, eq(usersCenters.centerId, centers.id))
    .where(
      and(
        eq(usersCenters.userId, user.id),
        eq(usersCenters.centerId, session.centerId),
        isNull(usersCenters.deletedAt),
        isNull(centers.deletedAt),
      ),
    )
    .limit(1)

  const membership = membershipRows[0]
  if (!membership) {
    throw createError({
      statusCode: 403,
      message: "Non hai un'appartenenza attiva per la sede selezionata.",
    })
  }

  const nav = computeRoleNavigation({
    isManager: membership.isManager,
    isAssistantManager: membership.isAssistantManager,
    isInstructor: membership.isInstructor,
  })

  const authContext: AuthContext = {
    userId: user.id,
    email: user.email,
    centerId: membership.centerId,
    centerName: membership.centerName,
    timezone: membership.timezone,
    name: membership.name,
    surname: membership.surname,
    phoneNumber: membership.phoneNumber,
    isManager: membership.isManager,
    isAssistantManager: membership.isAssistantManager,
    isInstructor: membership.isInstructor,
    ...nav,
  }

  event.context.auth = authContext
  return authContext
}

/**
 * Ensures the request has an authenticated user with an active center membership.
 */
export function requireAuth(event: H3Event): AuthContext {
  const auth = event.context.auth
  if (!auth) {
    throw createError({
      statusCode: 401,
      message: 'Autenticazione richiesta.',
    })
  }
  return auth
}

/**
 * Ensures the authenticated user is a worker (`is_manager`, `is_assistant_manager`, or `is_instructor`)
 * in the active center.
 */
export function requireWorker(event: H3Event): AuthContext {
  const auth = requireAuth(event)
  if (!auth.isWorker) {
    throw createError({
      statusCode: 403,
      message: 'Permessi insufficienti: accesso riservato ai lavoratori della sede.',
    })
  }
  return auth
}

/**
 * Ensures the authenticated user is the Manager or an Assistant Manager (`is_manager` or `is_assistant_manager`)
 * in the active center.
 */
export function requireManagerOrAssistant(event: H3Event): AuthContext {
  const auth = requireAuth(event)
  if (!auth.isManager && !auth.isAssistantManager) {
    throw createError({
      statusCode: 403,
      message: 'Permessi insufficienti: operazione riservata al gerente o ai vice gerenti.',
    })
  }
  return auth
}

/**
 * Ensures the authenticated user is strictly the Manager (`is_manager`) in the active center.
 */
export function requireManager(event: H3Event): AuthContext {
  const auth = requireAuth(event)
  if (!auth.isManager) {
    throw createError({
      statusCode: 403,
      message: 'Permessi insufficienti: operazione riservata esclusivamente al gerente.',
    })
  }
  return auth
}

/**
 * Reads and validates the request body using a shared Zod schema, throwing a 400 error
 * with localized Italian validation messages on failure.
 */
export async function readValidatedBodyWithZod<T extends z.ZodTypeAny>(
  event: H3Event,
  schema: T,
): Promise<z.infer<T>> {
  const rawBody = await readBody(event).catch(() => ({}))
  const parsed = schema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    throw createError({
      statusCode: 400,
      message: firstIssue?.message ?? 'Dati di input non validi.',
      data: {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    })
  }
  return parsed.data
}

/**
 * Extracts and validates a UUID route parameter (`:id` or `:userId`), supporting both
 * Nitro router context (`event.context.params`) and direct URL path extraction in tests.
 */
export function requireUuidParam(event: H3Event, paramName: 'id' | 'userId' = 'id'): string {
  let rawValue = getRouterParam(event, paramName)

  if (!rawValue) {
    const pathname = getRequestURL(event).pathname.replace(/\/+$/g, '')
    const segments = pathname.split('/').filter(Boolean)
    // Patterns:
    // /api/<resource>/:id -> segments[2]
    // /api/<resource>/:id/<subaction> -> segments[2]
    // /api/schedules/:id/enroll/:userId -> segments[2] for 'id', segments[4] for 'userId'
    if (paramName === 'id' && segments.length >= 3) {
      rawValue = segments[2]
    } else if (paramName === 'userId' && segments.length >= 5) {
      rawValue = segments[4]
    }
  }

  const parsed = uuidSchema.safeParse(rawValue)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: parsed.error.issues[0]?.message ?? 'Identificativo UUID non valido.',
    })
  }

  return parsed.data
}

