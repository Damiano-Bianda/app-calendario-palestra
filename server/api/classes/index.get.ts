import { and, asc, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { classes } from '../../db/schema.ts'
import { requireAuth } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = useDb(event)
  const query = getQuery(event)

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''
  const colorFilter = typeof query.color === 'string' ? query.color.trim().toLowerCase() : ''
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : 'name'
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc'

  const rows = await db
    .select()
    .from(classes)
    .where(and(eq(classes.centerId, auth.centerId), isNull(classes.deletedAt)))
    .orderBy(asc(classes.name))

  const filtered = rows.filter((cls) => {
    if (colorFilter && cls.color !== colorFilter) {
      return false
    }
    if (search) {
      const matchesName = cls.name.toLowerCase().includes(search)
      const matchesDesc = cls.description ? cls.description.toLowerCase().includes(search) : false
      if (!matchesName && !matchesDesc) {
        return false
      }
    }
    return true
  })

  filtered.sort((a, b) => {
    let cmp = 0
    if (sortBy === 'color') {
      cmp = a.color.localeCompare(b.color, 'it')
    } else if (sortBy === 'createdAt') {
      cmp = a.createdAt.localeCompare(b.createdAt)
    } else if (sortBy === 'updatedAt') {
      cmp = a.updatedAt.localeCompare(b.updatedAt)
    } else {
      cmp = a.name.localeCompare(b.name, 'it')
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  return {
    classes: filtered,
  }
})

