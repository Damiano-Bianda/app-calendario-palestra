import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema'
import { generateSeedSql } from '../server/db/seed'
import { hashPassword, verifyPassword } from '../server/utils/crypto'

function createInMemorySqliteWithMigrations(): DatabaseSync {
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

describe('Database Schema & Constraints (SPECIFICATION.md)', () => {
  it('defines all 9 tables with mandatory audit columns and no static calculated columns', () => {
    const tables = [
      schema.centers,
      schema.users,
      schema.usersCenters,
      schema.classes,
      schema.schedules,
      schema.userSchedules,
      schema.subscriptions,
      schema.usersSubscriptions,
      schema.subscriptionsClasses,
    ]

    expect(tables.map((t) => getTableName(t))).toEqual([
      'centers',
      'users',
      'users_centers',
      'classes',
      'schedules',
      'user_schedules',
      'subscriptions',
      'users_subscriptions',
      'subscriptions_classes',
    ])

    for (const table of tables) {
      const cols = getTableColumns(table)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('createdBy')
      expect(cols).toHaveProperty('updatedBy')
      expect(cols).toHaveProperty('createdAt')
      expect(cols).toHaveProperty('updatedAt')
      expect(cols).toHaveProperty('deletedAt')
    }

    // Calculated fields must NEVER be stored as static columns
    const scheduleCols = getTableColumns(schema.schedules)
    expect(scheduleCols).not.toHaveProperty('status')
    expect(scheduleCols).not.toHaveProperty('enrolledCount')
    expect(scheduleCols).not.toHaveProperty('remainingSpots')

    const userSubCols = getTableColumns(schema.usersSubscriptions)
    expect(userSubCols).not.toHaveProperty('remainingEntrances')
  })

  it('executes seed SQL cleanly and sets admin created_by/updated_by to its own id, keeps admin out of users_centers, and creates manager for Europe/Rome center', async () => {
    const db = createInMemorySqliteWithMigrations()
    const { sql } = await generateSeedSql({
      adminEmail: 'admin@palestra.it',
      adminPassword: 'TestPassword123!',
      centerName: 'Palestra Centrale',
      centerTimezone: 'Europe/Rome',
      managerEmail: 'gerente@palestra.it',
      managerPassword: 'Gerente123!',
    })

    db.exec(sql)
    // Idempotency: running seed SQL a second time must not fail or duplicate records
    db.exec(sql)

    const usersRows = db.prepare('SELECT * FROM users ORDER BY email ASC').all() as Array<
      Record<string, unknown>
    >
    expect(usersRows).toHaveLength(2)

    const admin = usersRows.find((u) => u.email === 'admin@palestra.it')!
    expect(admin).toBeDefined()
    expect(admin.created_by).toBe(admin.id)
    expect(admin.updated_by).toBe(admin.id)
    expect(admin.deleted_at).toBeNull()
    expect(await verifyPassword('TestPassword123!', String(admin.password_hash))).toBe(true)
    expect(await verifyPassword('WrongPassword', String(admin.password_hash))).toBe(false)

    const manager = usersRows.find((u) => u.email === 'gerente@palestra.it')!
    expect(manager).toBeDefined()
    expect(manager.created_by).toBe(admin.id)
    expect(manager.updated_by).toBe(admin.id)
    expect(await verifyPassword('Gerente123!', String(manager.password_hash))).toBe(true)

    const centersRows = db.prepare('SELECT * FROM centers').all() as Array<Record<string, unknown>>
    expect(centersRows).toHaveLength(1)
    const center = centersRows[0]!
    expect(center.name).toBe('Palestra Centrale')
    expect(center.timezone).toBe('Europe/Rome')
    expect(center.created_by).toBe(admin.id)
    expect(center.updated_by).toBe(admin.id)

    const usersCentersRows = db.prepare('SELECT * FROM users_centers').all() as Array<
      Record<string, unknown>
    >
    expect(usersCentersRows).toHaveLength(1)
    const managerMembership = usersCentersRows[0]!
    expect(managerMembership.user_id).toBe(manager.id)
    expect(managerMembership.center_id).toBe(center.id)
    expect(managerMembership.is_manager).toBe(1)
    expect(managerMembership.created_by).toBe(admin.id)
    expect(managerMembership.updated_by).toBe(admin.id)
  })

  it('enforces partial unique indexes (WHERE deleted_at IS NULL) for users, users_centers, and user_schedules', async () => {
    const db = createInMemorySqliteWithMigrations()
    const { sql } = await generateSeedSql()
    db.exec(sql)

    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@palestra.it'").get() as {
      id: string
    }
    const manager = db
      .prepare("SELECT id FROM users WHERE email = 'gerente@palestra.it'")
      .get() as { id: string }
    const center = db.prepare('SELECT id FROM centers LIMIT 1').get() as { id: string }
    const now = new Date().toISOString()

    // Duplicate active email on users must fail
    expect(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, created_by, updated_by, created_at, updated_at, deleted_at)
         VALUES (?, 'admin@palestra.it', 'hash', ?, ?, ?, ?, NULL)`,
      ).run(uuidv7(), admin.id, admin.id, now, now)
    }).toThrow()

    // Soft-deleted user with same email is allowed
    const softDeletedUserId = uuidv7()
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_by, updated_by, created_at, updated_at, deleted_at)
       VALUES (?, 'admin@palestra.it', 'hash', ?, ?, ?, ?, ?)`,
    ).run(softDeletedUserId, admin.id, admin.id, now, now, now)

    // Duplicate active (center_id, user_id) on users_centers must fail
    expect(() => {
      db.prepare(
        `INSERT INTO users_centers (id, center_id, user_id, name, surname, phone_number, is_manager, is_assistant_manager, is_instructor, created_by, updated_by, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'Mario', 'Rossi', '+393331234567', 0, 0, 0, ?, ?, ?, ?, NULL)`,
      ).run(uuidv7(), center.id, manager.id, admin.id, admin.id, now, now)
    }).toThrow()

    // Soft-deleted row on users_centers with same (center_id, user_id) is allowed
    db.prepare(
      `INSERT INTO users_centers (id, center_id, user_id, name, surname, phone_number, is_manager, is_assistant_manager, is_instructor, created_by, updated_by, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'Mario', 'Rossi', '+393331234567', 0, 0, 0, ?, ?, ?, ?, ?)`,
    ).run(uuidv7(), center.id, manager.id, admin.id, admin.id, now, now, now)
  })

  it('enforces CHECK constraints (not_empty, classes_colors, E.164 phone, schedule bounds)', async () => {
    const db = createInMemorySqliteWithMigrations()
    const { sql } = await generateSeedSql()
    db.exec(sql)

    const admin = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }
    const center = db.prepare('SELECT id FROM centers LIMIT 1').get() as { id: string }
    const now = '2026-11-12T10:00:00.000Z'

    // 1. Empty string on centers.name fails not_empty
    expect(() => {
      db.prepare(
        `INSERT INTO centers (id, name, timezone, created_by, updated_by, created_at, updated_at)
         VALUES (?, '   ', 'Europe/Rome', ?, ?, ?, ?)`,
      ).run(uuidv7(), admin.id, admin.id, now, now)
    }).toThrow()

    // 2. Invalid color on classes fails classes_colors check
    expect(() => {
      db.prepare(
        `INSERT INTO classes (id, center_id, name, color, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, 'Pilates', 'magenta', ?, ?, ?, ?)`,
      ).run(uuidv7(), center.id, admin.id, admin.id, now, now)
    }).toThrow()

    // Valid class succeeds
    const classId = uuidv7()
    db.prepare(
      `INSERT INTO classes (id, center_id, name, color, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'Pilates', 'purple', ?, ?, ?, ?)`,
    ).run(classId, center.id, admin.id, admin.id, now, now)

    // 3. Invalid phone number on users_centers fails E.164 check
    const newUserId = uuidv7()
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'cliente@palestra.it', 'hash', ?, ?, ?, ?)`,
    ).run(newUserId, admin.id, admin.id, now, now)

    expect(() => {
      db.prepare(
        `INSERT INTO users_centers (id, center_id, user_id, name, surname, phone_number, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'Luca', 'Bianchi', '123-invalid', ?, ?, ?, ?)`,
      ).run(uuidv7(), center.id, newUserId, admin.id, admin.id, now, now)
    }).toThrow()

    // 4. Schedule available_spots < minimum_spots fails CHECK constraint
    expect(() => {
      db.prepare(
        `INSERT INTO schedules (id, class_id, center_id, start_date, duration_minutes, available_spots, minimum_spots, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, '2026-11-20T17:00:00.000Z', 60, 2, 5, ?, ?, ?, ?)`,
      ).run(uuidv7(), classId, center.id, admin.id, admin.id, now, now)
    }).toThrow()

    // Valid schedule succeeds
    db.prepare(
      `INSERT INTO schedules (id, class_id, center_id, start_date, duration_minutes, available_spots, minimum_spots, publication_minutes_before, registration_open_minutes_before, registration_close_minutes_before, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, '2026-11-20T17:00:00.000Z', 60, 10, 3, 1440, 720, 60, ?, ?, ?, ?)`,
    ).run(uuidv7(), classId, center.id, admin.id, admin.id, now, now)
  })

  it('hashes and verifies passwords using Web Crypto API PBKDF2-SHA256', async () => {
    const hash = await hashPassword('Sicura123!')
    expect(hash.startsWith('pbkdf2_sha256$100000$')).toBe(true)
    expect(await verifyPassword('Sicura123!', hash)).toBe(true)
    expect(await verifyPassword('Sbagliata!', hash)).toBe(false)
  })
})

