import { and, asc, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { users, usersCenters } from '../../db/schema.ts'
import { requireWorker } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const db = useDb(event)
  const query = getQuery(event)

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''
  const roleFilter = typeof query.role === 'string' ? query.role.trim().toLowerCase() : ''
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : 'surname'
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc'

  const rows = await db
    .select({
      id: users.id,
      membershipId: usersCenters.id,
      centerId: usersCenters.centerId,
      email: users.email,
      name: usersCenters.name,
      surname: usersCenters.surname,
      phoneNumber: usersCenters.phoneNumber,
      isManager: usersCenters.isManager,
      isAssistantManager: usersCenters.isAssistantManager,
      isInstructor: usersCenters.isInstructor,
      createdAt: usersCenters.createdAt,
      updatedAt: usersCenters.updatedAt,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.centerId, auth.centerId),
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(usersCenters.surname), asc(usersCenters.name))

  const filtered = rows.filter((u) => {
    if (roleFilter === 'manager' && !u.isManager) {
      return false
    }
    if (roleFilter === 'assistant_manager' && !u.isAssistantManager) {
      return false
    }
    if (roleFilter === 'instructor' && !u.isInstructor) {
      return false
    }
    if (roleFilter === 'worker' && !u.isManager && !u.isAssistantManager && !u.isInstructor) {
      return false
    }
    if (roleFilter === 'customer' && (u.isManager || u.isAssistantManager || u.isInstructor)) {
      return false
    }

    if (search) {
      const fullName = `${u.name} ${u.surname}`.toLowerCase()
      const reverseName = `${u.surname} ${u.name}`.toLowerCase()
      const matchesName = fullName.includes(search) || reverseName.includes(search)
      const matchesEmail = u.email.toLowerCase().includes(search)
      const matchesPhone = u.phoneNumber.toLowerCase().includes(search)
      if (!matchesName && !matchesEmail && !matchesPhone) {
        return false
      }
    }

    return true
  })

  filtered.sort((a, b) => {
    let cmp = 0
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name, 'it') || a.surname.localeCompare(b.surname, 'it')
    } else if (sortBy === 'email') {
      cmp = a.email.localeCompare(b.email, 'it')
    } else if (sortBy === 'phoneNumber') {
      cmp = a.phoneNumber.localeCompare(b.phoneNumber)
    } else if (sortBy === 'createdAt') {
      cmp = a.createdAt.localeCompare(b.createdAt)
    } else {
      cmp = a.surname.localeCompare(b.surname, 'it') || a.name.localeCompare(b.name, 'it')
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  return {
    users: filtered,
  }
})

