import { defineEventHandler, getRequestURL, type H3Event } from 'h3'
import {
  authenticateRequest,
  requireManagerOrAssistant,
  requireWorker,
} from '../utils/auth.ts'

const PUBLIC_AUTH_ROUTES = new Set([
  'POST:/api/auth/login',
  'POST:/api/auth/recover',
  'POST:/api/auth/reset-password',
])

/**
 * Normalizes a pathname by stripping trailing slashes (except root `/`).
 */
export function normalizeApiPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/g, '')
  }
  return pathname
}

/**
 * Checks whether an API route is public according to SPECIFICATION.md.
 */
export function isPublicApiRoute(method: string, pathname: string): boolean {
  const key = `${method.toUpperCase()}:${normalizeApiPathname(pathname)}`
  return PUBLIC_AUTH_ROUTES.has(key)
}

/**
 * Enforces role-based permissions on `/api/*` routes according to the permissions tables in SPECIFICATION.md.
 */
export function enforceRouteRolePermissions(
  event: H3Event,
  method: string,
  rawPathname: string,
): void {
  const m = method.toUpperCase()
  const pathname = normalizeApiPathname(rawPathname)

  // Section 2: /api/classes
  if (pathname === '/api/classes') {
    if (m === 'POST') {
      requireManagerOrAssistant(event)
    }
    return
  }
  if (pathname.startsWith('/api/classes/')) {
    if (m === 'GET') {
      requireWorker(event)
    } else if (m === 'PUT' || m === 'DELETE') {
      requireManagerOrAssistant(event)
    }
    return
  }

  // Section 3: /api/schedules
  if (pathname === '/api/schedules') {
    if (m === 'POST') {
      requireManagerOrAssistant(event)
    }
    return
  }
  if (pathname.startsWith('/api/schedules/')) {
    if (pathname.endsWith('/email') && m === 'POST') {
      requireWorker(event)
      return
    }
    if (pathname.includes('/enroll')) {
      // Enrollment/unenrollment is allowed for Customers (self) and (Assistant) Managers
      return
    }
    if (m === 'PUT' || m === 'DELETE') {
      requireManagerOrAssistant(event)
    }
    return
  }

  // Section 4: /api/subscriptions
  if (pathname === '/api/subscriptions' || pathname.startsWith('/api/subscriptions/')) {
    if (m === 'GET') {
      requireWorker(event)
    } else if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
      requireManagerOrAssistant(event)
    }
    return
  }

  // Section 5: /api/user-subscriptions
  if (pathname === '/api/user-subscriptions' || pathname.startsWith('/api/user-subscriptions/')) {
    if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
      requireManagerOrAssistant(event)
    }
    return
  }

  // Section 6: /api/users
  if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
    if (m === 'GET') {
      requireWorker(event)
    } else if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
      requireManagerOrAssistant(event)
    }
    return
  }
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizeApiPathname(url.pathname)

  if (!pathname.startsWith('/api/')) {
    return
  }

  const method = event.method || 'GET'
  if (isPublicApiRoute(method, pathname)) {
    return
  }

  await authenticateRequest(event)
  enforceRouteRolePermissions(event, method, pathname)
})

