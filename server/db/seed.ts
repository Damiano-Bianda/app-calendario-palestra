import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { hashPassword } from '../utils/crypto.ts'
import type { AppDatabase } from '../utils/db.ts'
import { centers, users, usersCenters } from './schema.ts'

export interface SeedOptions {
  adminEmail?: string
  adminPassword?: string
  centerName?: string
  centerTimezone?: string
  managerEmail?: string
  managerPassword?: string
  managerName?: string
  managerSurname?: string
  managerPhone?: string
}

export interface SeedResult {
  adminId: string
  adminEmail: string
  centerId: string
  centerName: string
  centerTimezone: string
  managerId: string
  managerEmail: string
}

const DEFAULT_SEED_OPTIONS: Required<SeedOptions> = {
  adminEmail: 'admin@palestra.it',
  adminPassword: 'Admin123!',
  centerName: 'Palestra Centrale',
  centerTimezone: 'Europe/Rome',
  managerEmail: 'gerente@palestra.it',
  managerPassword: 'Gerente123!',
  managerName: 'Mario',
  managerSurname: 'Rossi',
  managerPhone: '+393330000000',
}

/**
 * Seeds the database programmatically using a Drizzle D1 database instance.
 * - Initializes the invisible `admin` user ONLY in `users` (`created_by = id`, `updated_by = id`).
 * - Initializes the sample center (`Palestra Centrale`, `Europe/Rome`) created by `admin`.
 * - Initializes a separate manager user (`gerente@palestra.it`) in `users` and `users_centers` (`is_manager = true`) created by `admin`.
 */
export async function seedDatabase(
  db: AppDatabase,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const cfg = { ...DEFAULT_SEED_OPTIONS, ...options }
  const now = new Date().toISOString()

  // 1. Check or create Admin user ONLY in `users` (created_by and updated_by point to its own id)
  const existingAdmin = await db.query.users.findFirst({
    where: and(eq(users.email, cfg.adminEmail), isNull(users.deletedAt)),
  })

  let adminId: string
  if (existingAdmin) {
    adminId = existingAdmin.id
  } else {
    adminId = uuidv7()
    const adminPasswordHash = await hashPassword(cfg.adminPassword)
    await db.insert(users).values({
      id: adminId,
      email: cfg.adminEmail,
      passwordHash: adminPasswordHash,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  // 2. Check or create Sample Center with Europe/Rome timezone (created_by = adminId)
  const existingCenter = await db.query.centers.findFirst({
    where: and(eq(centers.name, cfg.centerName), isNull(centers.deletedAt)),
  })

  let centerId: string
  if (existingCenter) {
    centerId = existingCenter.id
  } else {
    centerId = uuidv7()
    await db.insert(centers).values({
      id: centerId,
      name: cfg.centerName,
      timezone: cfg.centerTimezone,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  // 3. Check or create Manager user in `users` (created_by = adminId)
  const existingManager = await db.query.users.findFirst({
    where: and(eq(users.email, cfg.managerEmail), isNull(users.deletedAt)),
  })

  let managerId: string
  if (existingManager) {
    managerId = existingManager.id
  } else {
    managerId = uuidv7()
    const managerPasswordHash = await hashPassword(cfg.managerPassword)
    await db.insert(users).values({
      id: managerId,
      email: cfg.managerEmail,
      passwordHash: managerPasswordHash,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  // 4. Check or create Manager membership in `users_centers` (is_manager = true, created_by = adminId)
  const existingMembership = await db.query.usersCenters.findFirst({
    where: and(
      eq(usersCenters.centerId, centerId),
      eq(usersCenters.userId, managerId),
      isNull(usersCenters.deletedAt),
    ),
  })

  if (!existingMembership) {
    await db.insert(usersCenters).values({
      id: uuidv7(),
      centerId,
      userId: managerId,
      name: cfg.managerName,
      surname: cfg.managerSurname,
      phoneNumber: cfg.managerPhone,
      isManager: true,
      isAssistantManager: false,
      isInstructor: false,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  return {
    adminId,
    adminEmail: cfg.adminEmail,
    centerId,
    centerName: cfg.centerName,
    centerTimezone: cfg.centerTimezone,
    managerId,
    managerEmail: cfg.managerEmail,
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Generates an idempotent SQL seed script for Wrangler D1 CLI execution.
 */
export async function generateSeedSql(options: SeedOptions = {}): Promise<{
  sql: string
  adminId: string
  centerId: string
  managerId: string
}> {
  const cfg = { ...DEFAULT_SEED_OPTIONS, ...options }
  const adminId = uuidv7()
  const centerId = uuidv7()
  const managerId = uuidv7()
  const userCenterId = uuidv7()
  const now = new Date().toISOString()

  const adminPasswordHash = await hashPassword(cfg.adminPassword)
  const managerPasswordHash = await hashPassword(cfg.managerPassword)

  const adminEmailEsc = escapeSql(cfg.adminEmail)
  const adminHashEsc = escapeSql(adminPasswordHash)
  const centerNameEsc = escapeSql(cfg.centerName)
  const timezoneEsc = escapeSql(cfg.centerTimezone)
  const managerEmailEsc = escapeSql(cfg.managerEmail)
  const managerHashEsc = escapeSql(managerPasswordHash)
  const managerNameEsc = escapeSql(cfg.managerName)
  const managerSurnameEsc = escapeSql(cfg.managerSurname)
  const managerPhoneEsc = escapeSql(cfg.managerPhone)

  const sql = `
-- 1. Initialize Admin User ONLY in users (created_by and updated_by point to its own id)
INSERT INTO users (id, email, password_hash, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT '${adminId}', '${adminEmailEsc}', '${adminHashEsc}', '${adminId}', '${adminId}', '${now}', '${now}', NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL);

-- 2. Initialize Sample Center with Europe/Rome timezone (created_by = admin)
INSERT INTO centers (id, name, timezone, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT
  '${centerId}',
  '${centerNameEsc}',
  '${timezoneEsc}',
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  '${now}',
  '${now}',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM centers WHERE name = '${centerNameEsc}' AND deleted_at IS NULL);

-- 3. Initialize Manager User in users (created_by = admin)
INSERT INTO users (id, email, password_hash, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT
  '${managerId}',
  '${managerEmailEsc}',
  '${managerHashEsc}',
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  '${now}',
  '${now}',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = '${managerEmailEsc}' AND deleted_at IS NULL);

-- 4. Associate Manager User with Sample Center in users_centers (is_manager = true, created_by = admin)
INSERT INTO users_centers (id, center_id, user_id, name, surname, phone_number, is_manager, is_assistant_manager, is_instructor, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT
  '${userCenterId}',
  (SELECT id FROM centers WHERE name = '${centerNameEsc}' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM users WHERE email = '${managerEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  '${managerNameEsc}',
  '${managerSurnameEsc}',
  '${managerPhoneEsc}',
  1,
  0,
  0,
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM users WHERE email = '${adminEmailEsc}' AND deleted_at IS NULL LIMIT 1),
  '${now}',
  '${now}',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM users_centers
  WHERE center_id = (SELECT id FROM centers WHERE name = '${centerNameEsc}' AND deleted_at IS NULL LIMIT 1)
    AND user_id = (SELECT id FROM users WHERE email = '${managerEmailEsc}' AND deleted_at IS NULL LIMIT 1)
    AND deleted_at IS NULL
);
`.trim()

  return { sql, adminId, centerId, managerId }
}

async function runCli() {
  const { execFileSync } = await import('node:child_process')
  const { writeFileSync, unlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  if (!process.argv[1] || fileURLToPath(import.meta.url) !== process.argv[1]) {
    return
  }

  const isRemote = process.argv.includes('--remote')
  const targetFlag = isRemote ? '--remote' : '--local'
  const dbName = process.env.D1_DATABASE_NAME ?? 'app-calendario-palestra-db'

  const { sql, adminId, centerId, managerId } = await generateSeedSql({
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? DEFAULT_SEED_OPTIONS.adminEmail,
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_SEED_OPTIONS.adminPassword,
    centerName: process.env.SEED_CENTER_NAME ?? DEFAULT_SEED_OPTIONS.centerName,
    managerEmail: process.env.SEED_MANAGER_EMAIL ?? DEFAULT_SEED_OPTIONS.managerEmail,
    managerPassword: process.env.SEED_MANAGER_PASSWORD ?? DEFAULT_SEED_OPTIONS.managerPassword,
  })
  const tempSqlFile = join(tmpdir(), `d1-seed-${Date.now()}.sql`)

  try {
    writeFileSync(tempSqlFile, sql, 'utf-8')
    const wranglerBin = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')
    execFileSync(
      process.execPath,
      [wranglerBin, 'd1', 'execute', dbName, targetFlag, `--file=${tempSqlFile}`],
      { stdio: 'inherit' },
    )
    console.log(
      `Seed completed (${targetFlag}): admin=${DEFAULT_SEED_OPTIONS.adminEmail} (candidate id=${adminId}), manager=${DEFAULT_SEED_OPTIONS.managerEmail} (candidate id=${managerId}), center="${DEFAULT_SEED_OPTIONS.centerName}" (${DEFAULT_SEED_OPTIONS.centerTimezone}, candidate id=${centerId})`,
    )
  } finally {
    try {
      unlinkSync(tempSqlFile)
    } catch {
      // ignore temp file cleanup errors
    }
  }
}

if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('server/db/seed.ts')
) {
  runCli().catch((err) => {
    console.error('Failed to seed database:', err)
    process.exit(1)
  })
}
