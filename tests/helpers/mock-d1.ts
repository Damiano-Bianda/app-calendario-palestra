import { readFileSync, readdirSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Readable } from 'node:stream'
import type { D1Database } from '@cloudflare/workers-types'
import { createEvent, type H3Event } from 'h3'

export function createInMemorySqliteWithMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')

  const migrationsDir = join(process.cwd(), 'server', 'db', 'migrations')
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of sqlFiles) {
    const content = readFileSync(join(migrationsDir, file), 'utf-8')
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of statements) {
      db.exec(stmt)
    }
  }

  return db
}

function normalizeSqlParams(params: unknown[]): SQLInputValue[] {
  return params.map((p) => {
    if (typeof p === 'boolean') {
      return p ? 1 : 0
    }
    if (p === undefined) {
      return null
    }
    return p as SQLInputValue
  })
}

interface MockBoundStatement {
  sql: string
  params: SQLInputValue[]
  bind: (...values: unknown[]) => MockBoundStatement
  run: () => Promise<{
    success: boolean
    results: unknown[]
    meta: { changes: number; last_row_id: number }
  }>
  all: () => Promise<{
    success: boolean
    results: Record<string, unknown>[]
    meta: Record<string, unknown>
  }>
  raw: () => Promise<unknown[][]>
  first: <T = Record<string, unknown>>(colName?: string) => Promise<T | null>
}

export function createMockD1Database(sqlite: DatabaseSync): D1Database {
  const createBoundStmt = (sql: string, boundParams: SQLInputValue[] = []): MockBoundStatement => {
    return {
      sql,
      params: boundParams,
      bind(...values: unknown[]) {
        return createBoundStmt(sql, normalizeSqlParams(values))
      },
      async run() {
        const stmt = sqlite.prepare(sql)
        const info = stmt.run(...boundParams)
        return {
          success: true,
          results: [],
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
          },
        }
      },
      async all() {
        const stmt = sqlite.prepare(sql)
        stmt.setReturnArrays(false)
        const rows = stmt.all(...boundParams) as Record<string, unknown>[]
        return {
          success: true,
          results: rows,
          meta: {},
        }
      },
      async raw() {
        const stmt = sqlite.prepare(sql)
        stmt.setReturnArrays(true)
        const rows = stmt.all(...boundParams) as unknown[][]
        return rows
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(sql)
        stmt.setReturnArrays(false)
        const row = stmt.get(...boundParams) as Record<string, unknown> | undefined
        if (!row) {
          return null
        }
        if (colName) {
          return (row[colName] as T) ?? null
        }
        return row as unknown as T
      },
    }
  }

  const d1 = {
    prepare(sql: string) {
      return createBoundStmt(sql, [])
    },
    async batch(statements: MockBoundStatement[]) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const stmt of statements) {
          const trimmed = stmt.sql.trim().toUpperCase()
          if (trimmed.startsWith('SELECT') || trimmed.includes('RETURNING')) {
            results.push(await stmt.all())
          } else {
            results.push(await stmt.run())
          }
        }
        sqlite.exec('COMMIT')
        return results
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql)
      return { count: 1, duration: 0 }
    },
  }

  return d1 as unknown as D1Database
}

export interface CreateTestEventOptions {
  method?: string
  url?: string
  body?: unknown
  cookies?: Record<string, string>
  headers?: Record<string, string>
  d1: D1Database
  authSecret?: string
  appUrl?: string
}

/**
 * Creates a realistic Nuxt/Nitro H3Event for testing server routes and middleware.
 */
export function createTestH3Event(options: CreateTestEventOptions): H3Event {
  const method = (options.method ?? 'GET').toUpperCase()
  const url = options.url ?? '/'
  const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : ''

  const socket = new Socket()
  const req = new IncomingMessage(socket)
  req.method = method
  req.url = url
  req.headers = {
    host: 'palestra.com',
    ...(options.body !== undefined
      ? {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(bodyStr)),
        }
      : {}),
    ...options.headers,
  }

  if (options.cookies && Object.keys(options.cookies).length > 0) {
    req.headers.cookie = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  if (options.body !== undefined) {
    const stream = Readable.from([Buffer.from(bodyStr)])
    req.push(Buffer.from(bodyStr))
    req.push(null)
    void stream
  } else {
    req.push(null)
  }

  const res = new ServerResponse(req)
  const event = createEvent(req, res)

  event.context.cloudflare = {
    env: {
      DB: options.d1,
      AUTH_SECRET: options.authSecret ?? 'test-cloudflare-secret-2026',
      APP_URL: options.appUrl ?? 'https://palestra.com',
    },
  }

  return event
}

/**
 * Extracts a cookie value set via `Set-Cookie` on the H3Event response.
 */
export function extractSetCookieValue(event: H3Event, cookieName: string): string | null {
  const setCookieHeader = event.node.res.getHeader('set-cookie')
  if (!setCookieHeader) {
    return null
  }
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [String(setCookieHeader)]
  for (const header of headers) {
    const firstPart = header.split(';')[0]?.trim()
    if (firstPart && firstPart.startsWith(`${cookieName}=`)) {
      return firstPart.slice(cookieName.length + 1)
    }
  }
  return null
}

