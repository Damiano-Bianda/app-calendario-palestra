# Project Rules & AI Guidelines (GEMINI.md / .antigravity/rules.md)

## 1. Source of Truth
* Always read and strictly follow `SPECIFICATION.md` located in the project root before designing, creating, or modifying any database schema, API endpoint, domain helper, or UI component.
* Do not invent features outside of `SPECIFICATION.md`.

## 2. Tech Stack & Runtime Constraints
* **Framework**: Nuxt 4 (Vue 3 Composition API, `<script setup lang="ts">`, Nitro Server Routes).
* **Styling**: Tailwind CSS (responsive mobile-first design supporting Android, iOS PWA, and desktop browsers).
* **Database & ORM**: Cloudflare D1 (SQLite) with Drizzle ORM.
* **Validation**: Shared Zod schemas (`shared/schemas/*` or `utils/validators/*`) enforced on both frontend forms and backend API endpoints.
* **Edge Compatibility**: All server code runs on **Cloudflare Workers**. Never use Node.js native C++ addons (e.g., native `bcrypt` or `fs`). Use Web Crypto API (`crypto.subtle`) or pure JS/Edge-compatible libraries for password hashing, UUIDv7 generation, and HMAC stateless token signing.

## 3. Language Conventions
* **Codebase (English)**: All table names, column names, TypeScript interfaces, variables, functions, route filenames, and code comments MUST be in **English**.
* **User Interface & Communications (Italian)**: All UI labels, buttons, validation error messages, and transactional emails MUST be in **Italian**.

## 4. Database, Soft Delete & Concurrency Rules
* **UUIDv7**: Every primary key (`id`) is a `CHAR(36)` UUIDv7 string.
* **Audit Columns**: Every table includes `created_by`, `updated_by`, `created_at`, `updated_at`, and `deleted_at`.
* **Strict Soft Delete**: NEVER execute physical `DELETE FROM` SQL queries. Always perform soft deletes by setting `deleted_at = new Date().toISOString()` and `updated_by = currentUserId`.
* **Read Filtering**: Every `SELECT` query and Drizzle relation check MUST filter by `isNull(table.deletedAt)` (except when specifically checking `CANCELLED_BY_PROVIDER` schedules where `schedules.deleted_at IS NOT NULL`).
* **Partial Unique Indexes**: Enforce uniqueness on active records using SQLite partial indexes (`WHERE deleted_at IS NULL`) for `users(email)`, `users_centers(center_id, user_id)`, and `user_schedules(schedule_id, user_id)`.
* **Calculated Fields (Never store as static columns)**:
  * `schedules.status`, `schedules.enrolled_count`, and `schedules.remaining_spots` are dynamically computed according to the exact formulas in `SPECIFICATION.md`.
  * `users_subscriptions.remaining_entrances` is dynamically computed by subtracting active valid rows in `user_schedules` from `users_subscriptions.entrances`, as specified in `SPECIFICATION.md`.
* **Atomicity**: Use D1 batch/transactions for recurring schedule creation, lesson enrollment, unenrollment, and automatic queue promotion.

## 5. Date, Time & Timezone Rules
* **Storage**: All dates and timestamps in SQLite are stored as UTC ISO 8601 strings (`CHAR(24)`, e.g., `2026-11-10T17:00:00.000Z`).
* **Write Conversion (DST-aware)**: When a manager creates or edits a schedule in a center's local time, convert the local date/time to UTC by calculating the IANA timezone offset (`centers.timezone`, e.g., `'Europe/Rome'`) on the **target future date of the lesson**, never using the current day's offset.
* **Read Formatting**: Always display dates and times anchored to `center.timezone` using `Intl.DateTimeFormat('it-IT', { timeZone: center.timezone, ... })`, ignoring the client device's local timezone.

---

## 6. Recommended Step-by-Step Implementation Prompts for Antigravity IDE

Copy and paste these prompts one at a time in the Antigravity chat:

1. **Step 1 - Database & Seed**:
   `Read @SPECIFICATION.md (Technical Requirements and Database sections). Configure Drizzle ORM for Cloudflare D1 and create the complete schema for all 8 tables, including audit fields, CHECK constraints, and partial unique indexes (WHERE deleted_at IS NULL). Also create a seed script that initializes the admin user and a sample center with Europe/Rome timezone.`
2. **Step 2 - Domain Logic, Timezones & Zod Schemas**:
   `Based on @SPECIFICATION.md, create the shared Zod validation schemas and domain utility functions (with Vitest unit tests): 1) DST-aware conversion between center IANA timezone and UTC ISO 8601, 2) calculation of schedules status, enrolled_count, and remaining_spots, 3) calculation of remaining_entrances for users_subscriptions.`
3. **Step 3 - Auth, Stateless Recovery Token & Middleware**:
   `Implement Section 1 of the API in @SPECIFICATION.md (/api/auth/* and /api/settings/*), the 30-minute stateless HMAC recovery token logic, and the Nuxt server middleware verifying authentication, active center membership (users_centers.deleted_at IS NULL), and role permissions.`
4. **Step 4 - Core CRUD APIs & Email Service**:
   `Implement Sections 2, 4, 5, and 6 of the API in @SPECIFICATION.md (classes, subscriptions, user-subscriptions, users) enforcing all business rules and deletion/modification guards. Include a transactional email service (Resend/Brevo) with a development console fallback.`
5. **Step 5 - Schedules, Enrollment, Queue & Customer Summary APIs**:
   `Implement Sections 3 and 7 of the API in @SPECIFICATION.md (/api/schedules/* and /api/customer/summary), using atomic operations for recurring schedule generation, enrollment, unenrollment, and automatic queue promotion with email notifications.`
6. **Step 6 - Worker Layout & Pages (/worker/*)**:
   `Implement the Worker layout, responsive Navbar, worker/customer mode toggle, instructor read-only guards, and all /worker/* pages defined in the GUI & Routing section of @SPECIFICATION.md, including the weekly/monthly desktop calendar and daily mobile calendar.`
7. **Step 7 - Customer Layout & Pages (/customer/*, /login, /recover, /settings)**:
   `Implement /login, /recover, /settings, /customer (with the 4-row user course card component), and /customer/summary according to @SPECIFICATION.md. Verify all end-to-end flows.`