import { sql, relations } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  check,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
import { uuidv7 } from 'uuidv7'

export const CLASS_COLORS = [
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'cyan',
] as const

export type ClassColor = (typeof CLASS_COLORS)[number]

/**
 * Shared audit columns present on all tables as specified in SPECIFICATION.md.
 */
const auditColumns = () => ({
  createdBy: text('created_by', { length: 36 })
    .notNull()
    .references((): AnySQLiteColumn => users.id),
  updatedBy: text('updated_by', { length: 36 })
    .notNull()
    .references((): AnySQLiteColumn => users.id),
  createdAt: text('created_at', { length: 24 })
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at', { length: 24 })
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
    .$defaultFn(() => new Date().toISOString()),
  deletedAt: text('deleted_at', { length: 24 }),
})

/**
 * Shared CHECK constraints for audit columns (not_empty).
 */
const auditChecks = (
  tableName: string,
  table: {
    createdBy: AnySQLiteColumn
    updatedBy: AnySQLiteColumn
    createdAt: AnySQLiteColumn
    updatedAt: AnySQLiteColumn
    deletedAt: AnySQLiteColumn
  },
) => [
  check(`${tableName}_created_by_not_empty`, sql`LENGTH(TRIM(${table.createdBy})) > 0`),
  check(`${tableName}_updated_by_not_empty`, sql`LENGTH(TRIM(${table.updatedBy})) > 0`),
  check(`${tableName}_created_at_not_empty`, sql`LENGTH(TRIM(${table.createdAt})) > 0`),
  check(`${tableName}_updated_at_not_empty`, sql`LENGTH(TRIM(${table.updatedAt})) > 0`),
  check(
    `${tableName}_deleted_at_not_empty`,
    sql`${table.deletedAt} IS NULL OR LENGTH(TRIM(${table.deletedAt})) > 0`,
  ),
]

/**
 * 1. Table `centers` (sedi)
 */
export const centers = sqliteTable(
  'centers',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: text('name', { length: 255 }).notNull(),
    timezone: text('timezone').notNull(),
    ...auditColumns(),
  },
  (table) => [
    check('centers_name_not_empty', sql`LENGTH(TRIM(${table.name})) > 0`),
    check('centers_timezone_not_empty', sql`LENGTH(TRIM(${table.timezone})) > 0`),
    ...auditChecks('centers', table),
  ],
)

/**
 * 2. Table `users` (utenti)
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    email: text('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash', { length: 255 }).notNull(),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('users_email_active_idx')
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    check('users_email_not_empty', sql`LENGTH(TRIM(${table.email})) > 0`),
    check('users_password_hash_not_empty', sql`LENGTH(TRIM(${table.passwordHash})) > 0`),
    ...auditChecks('users', table),
  ],
)

/**
 * 3. Table `users_centers` (per utenti multisede)
 */
export const usersCenters = sqliteTable(
  'users_centers',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    userId: text('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    name: text('name', { length: 255 }).notNull(),
    surname: text('surname', { length: 255 }).notNull(),
    phoneNumber: text('phone_number', { length: 20 }).notNull(),
    isManager: integer('is_manager', { mode: 'boolean' }).notNull().default(false),
    isAssistantManager: integer('is_assistant_manager', { mode: 'boolean' })
      .notNull()
      .default(false),
    isInstructor: integer('is_instructor', { mode: 'boolean' }).notNull().default(false),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('users_centers_center_user_active_idx')
      .on(table.centerId, table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    check('users_centers_name_not_empty', sql`LENGTH(TRIM(${table.name})) > 0`),
    check('users_centers_surname_not_empty', sql`LENGTH(TRIM(${table.surname})) > 0`),
    check('users_centers_phone_not_empty', sql`LENGTH(TRIM(${table.phoneNumber})) > 0`),
    check(
      'users_centers_phone_e164',
      sql`LENGTH(CASE WHEN SUBSTR(${table.phoneNumber}, 1, 1) = '+' THEN SUBSTR(${table.phoneNumber}, 2) ELSE ${table.phoneNumber} END) BETWEEN 7 AND 15 AND NOT ((CASE WHEN SUBSTR(${table.phoneNumber}, 1, 1) = '+' THEN SUBSTR(${table.phoneNumber}, 2) ELSE ${table.phoneNumber} END) GLOB '*[^0-9]*')`,
    ),
    ...auditChecks('users_centers', table),
  ],
)

/**
 * 4. Table `classes` (corsi)
 */
export const classes = sqliteTable(
  'classes',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    name: text('name', { length: 255 }).notNull(),
    description: text('description', { length: 1000 }),
    color: text('color').$type<ClassColor>().notNull().default('black'),
    ...auditColumns(),
  },
  (table) => [
    check('classes_name_not_empty', sql`LENGTH(TRIM(${table.name})) > 0`),
    check(
      'classes_description_not_empty',
      sql`${table.description} IS NULL OR LENGTH(TRIM(${table.description})) > 0`,
    ),
    check(
      'classes_colors',
      sql`${table.color} IN ('black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan')`,
    ),
    ...auditChecks('classes', table),
  ],
)

/**
 * 5. Table `schedules` (lezione)
 * Note: `status`, `enrolled_count`, and `remaining_spots` are dynamically calculated
 * and NEVER stored as static columns.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    classId: text('class_id', { length: 36 })
      .notNull()
      .references(() => classes.id),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    instructorId: text('instructor_id', { length: 36 }).references(() => users.id),
    startDate: text('start_date', { length: 24 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    availableSpots: integer('available_spots'),
    minimumSpots: integer('minimum_spots').notNull(),
    publicationMinutesBefore: integer('publication_minutes_before'),
    registrationOpenMinutesBefore: integer('registration_open_minutes_before'),
    registrationCloseMinutesBefore: integer('registration_close_minutes_before'),
    ...auditColumns(),
  },
  (table) => [
    check('schedules_start_date_not_empty', sql`LENGTH(TRIM(${table.startDate})) > 0`),
    check(
      'schedules_duration_minutes_valid',
      sql`${table.durationMinutes} >= 5 AND ${table.durationMinutes} % 5 = 0`,
    ),
    check('schedules_minimum_spots_valid', sql`${table.minimumSpots} >= 1`),
    check(
      'schedules_available_spots_valid',
      sql`${table.availableSpots} IS NULL OR ${table.availableSpots} >= ${table.minimumSpots}`,
    ),
    check(
      'schedules_publication_minutes_valid',
      sql`${table.publicationMinutesBefore} IS NULL OR (${table.publicationMinutesBefore} >= 1 AND ${table.publicationMinutesBefore} % 5 = 0)`,
    ),
    check(
      'schedules_registration_open_minutes_valid',
      sql`${table.registrationOpenMinutesBefore} IS NULL OR (${table.registrationOpenMinutesBefore} >= 1 AND ${table.registrationOpenMinutesBefore} % 5 = 0)`,
    ),
    check(
      'schedules_registration_close_minutes_valid',
      sql`${table.registrationCloseMinutesBefore} IS NULL OR ${table.registrationCloseMinutesBefore} >= 1`,
    ),
    check(
      'schedules_timeline_order_valid',
      sql`julianday(${table.startDate}) >= (julianday(${table.startDate}) - (COALESCE(${table.registrationCloseMinutesBefore}, 0) / 1440.0)) AND (julianday(${table.startDate}) - (COALESCE(${table.registrationCloseMinutesBefore}, 0) / 1440.0)) >= (CASE WHEN ${table.registrationOpenMinutesBefore} IS NULL THEN julianday(${table.createdAt}) ELSE julianday(${table.startDate}) - (${table.registrationOpenMinutesBefore} / 1440.0) END) AND (CASE WHEN ${table.registrationOpenMinutesBefore} IS NULL THEN julianday(${table.createdAt}) ELSE julianday(${table.startDate}) - (${table.registrationOpenMinutesBefore} / 1440.0) END) >= (CASE WHEN ${table.publicationMinutesBefore} IS NULL THEN julianday(${table.createdAt}) ELSE julianday(${table.startDate}) - (${table.publicationMinutesBefore} / 1440.0) END) AND (CASE WHEN ${table.publicationMinutesBefore} IS NULL THEN julianday(${table.createdAt}) ELSE julianday(${table.startDate}) - (${table.publicationMinutesBefore} / 1440.0) END) >= julianday(${table.createdAt})`,
    ),
    ...auditChecks('schedules', table),
  ],
)

/**
 * 6. Table `user_schedules` (iscrizioni alle lezioni)
 */
export const userSchedules = sqliteTable(
  'user_schedules',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    userId: text('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    scheduleId: text('schedule_id', { length: 36 })
      .notNull()
      .references(() => schedules.id),
    userSubscriptionId: text('user_subscription_id', { length: 36 })
      .notNull()
      .references(() => usersSubscriptions.id),
    isQueued: integer('is_queued', { mode: 'boolean' }).notNull().default(false),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('user_schedules_schedule_user_active_idx')
      .on(table.scheduleId, table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    ...auditChecks('user_schedules', table),
  ],
)

/**
 * 7. Table `subscriptions` (abbonamenti)
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    name: text('name', { length: 255 }).notNull(),
    description: text('description', { length: 1000 }),
    entrances: integer('entrances'),
    durationDays: integer('duration_days'),
    ...auditColumns(),
  },
  (table) => [
    check('subscriptions_name_not_empty', sql`LENGTH(TRIM(${table.name})) > 0`),
    check(
      'subscriptions_description_not_empty',
      sql`${table.description} IS NULL OR LENGTH(TRIM(${table.description})) > 0`,
    ),
    check(
      'subscriptions_entrances_valid',
      sql`${table.entrances} IS NULL OR ${table.entrances} >= 1`,
    ),
    check(
      'subscriptions_duration_days_valid',
      sql`${table.durationDays} IS NULL OR ${table.durationDays} >= 1`,
    ),
    ...auditChecks('subscriptions', table),
  ],
)

/**
 * 8. Table `users_subscriptions` (sottoscrizione d'abbonamento)
 * Note: `remaining_entrances` is dynamically calculated and NEVER stored as a static column.
 */
export const usersSubscriptions = sqliteTable(
  'users_subscriptions',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    subscriptionId: text('subscription_id', { length: 36 })
      .notNull()
      .references(() => subscriptions.id),
    centerId: text('center_id', { length: 36 })
      .notNull()
      .references(() => centers.id),
    userId: text('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    startDate: text('start_date', { length: 24 }).notNull(),
    endDate: text('end_date', { length: 24 }),
    entrances: integer('entrances'),
    ...auditColumns(),
  },
  (table) => [
    check('users_subscriptions_start_date_not_empty', sql`LENGTH(TRIM(${table.startDate})) > 0`),
    check(
      'users_subscriptions_end_date_valid',
      sql`${table.endDate} IS NULL OR (LENGTH(TRIM(${table.endDate})) > 0 AND ${table.endDate} > ${table.startDate})`,
    ),
    check(
      'users_subscriptions_entrances_valid',
      sql`${table.entrances} IS NULL OR ${table.entrances} >= 1`,
    ),
    ...auditChecks('users_subscriptions', table),
  ],
)

/**
 * 9. Table `subscriptions_classes` (corsi dell'abbonamento)
 */
export const subscriptionsClasses = sqliteTable(
  'subscriptions_classes',
  {
    id: text('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    subscriptionId: text('subscription_id', { length: 36 })
      .notNull()
      .references(() => subscriptions.id),
    classId: text('class_id', { length: 36 })
      .notNull()
      .references(() => classes.id),
    ...auditColumns(),
  },
  (table) => [...auditChecks('subscriptions_classes', table)],
)

// ============================================================================
// Drizzle Relations
// ============================================================================

export const centersRelations = relations(centers, ({ many }) => ({
  usersCenters: many(usersCenters),
  classes: many(classes),
  schedules: many(schedules),
  userSchedules: many(userSchedules),
  subscriptions: many(subscriptions),
  usersSubscriptions: many(usersSubscriptions),
}))

export const usersRelations = relations(users, ({ many }) => ({
  usersCenters: many(usersCenters),
  instructedSchedules: many(schedules),
  userSchedules: many(userSchedules),
  usersSubscriptions: many(usersSubscriptions),
}))

export const usersCentersRelations = relations(usersCenters, ({ one }) => ({
  center: one(centers, {
    fields: [usersCenters.centerId],
    references: [centers.id],
  }),
  user: one(users, {
    fields: [usersCenters.userId],
    references: [users.id],
  }),
}))

export const classesRelations = relations(classes, ({ one, many }) => ({
  center: one(centers, {
    fields: [classes.centerId],
    references: [centers.id],
  }),
  schedules: many(schedules),
  subscriptionsClasses: many(subscriptionsClasses),
}))

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  class: one(classes, {
    fields: [schedules.classId],
    references: [classes.id],
  }),
  center: one(centers, {
    fields: [schedules.centerId],
    references: [centers.id],
  }),
  instructor: one(users, {
    fields: [schedules.instructorId],
    references: [users.id],
  }),
  userSchedules: many(userSchedules),
}))

export const userSchedulesRelations = relations(userSchedules, ({ one }) => ({
  center: one(centers, {
    fields: [userSchedules.centerId],
    references: [centers.id],
  }),
  user: one(users, {
    fields: [userSchedules.userId],
    references: [users.id],
  }),
  schedule: one(schedules, {
    fields: [userSchedules.scheduleId],
    references: [schedules.id],
  }),
  userSubscription: one(usersSubscriptions, {
    fields: [userSchedules.userSubscriptionId],
    references: [usersSubscriptions.id],
  }),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  center: one(centers, {
    fields: [subscriptions.centerId],
    references: [centers.id],
  }),
  subscriptionsClasses: many(subscriptionsClasses),
  usersSubscriptions: many(usersSubscriptions),
}))

export const usersSubscriptionsRelations = relations(usersSubscriptions, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [usersSubscriptions.subscriptionId],
    references: [subscriptions.id],
  }),
  center: one(centers, {
    fields: [usersSubscriptions.centerId],
    references: [centers.id],
  }),
  user: one(users, {
    fields: [usersSubscriptions.userId],
    references: [users.id],
  }),
  userSchedules: many(userSchedules),
}))

export const subscriptionsClassesRelations = relations(subscriptionsClasses, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscriptionsClasses.subscriptionId],
    references: [subscriptions.id],
  }),
  class: one(classes, {
    fields: [subscriptionsClasses.classId],
    references: [classes.id],
  }),
}))

