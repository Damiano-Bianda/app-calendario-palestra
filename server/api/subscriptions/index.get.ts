import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { classes, subscriptions, subscriptionsClasses } from '../../db/schema.ts'
import { requireWorker } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireWorker(event)
  const db = useDb(event)
  const query = getQuery(event)

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : 'name'
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc'

  const subRows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.centerId, auth.centerId), isNull(subscriptions.deletedAt)))
    .orderBy(asc(subscriptions.name))

  const subIds = subRows.map((s) => s.id)
  const classesBySubId = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >()

  if (subIds.length > 0) {
    const scRows = await db
      .select({
        subscriptionId: subscriptionsClasses.subscriptionId,
        classId: classes.id,
        className: classes.name,
        classColor: classes.color,
      })
      .from(subscriptionsClasses)
      .innerJoin(classes, eq(subscriptionsClasses.classId, classes.id))
      .where(
        and(
          inArray(subscriptionsClasses.subscriptionId, subIds),
          isNull(subscriptionsClasses.deletedAt),
          isNull(classes.deletedAt),
        ),
      )
      .orderBy(asc(classes.name))

    for (const row of scRows) {
      const list = classesBySubId.get(row.subscriptionId) ?? []
      list.push({
        id: row.classId,
        name: row.className,
        color: row.classColor,
      })
      classesBySubId.set(row.subscriptionId, list)
    }
  }

  const enriched = subRows.map((sub) => {
    const associatedClasses = classesBySubId.get(sub.id) ?? []
    return {
      ...sub,
      classes: associatedClasses,
      classIds: associatedClasses.map((c) => c.id),
    }
  })

  const filtered = enriched.filter((sub) => {
    if (!search) {
      return true
    }
    const matchesName = sub.name.toLowerCase().includes(search)
    const matchesDesc = sub.description ? sub.description.toLowerCase().includes(search) : false
    const matchesClass = sub.classes.some((c) => c.name.toLowerCase().includes(search))
    return matchesName || matchesDesc || matchesClass
  })

  filtered.sort((a, b) => {
    let cmp = 0
    if (sortBy === 'entrances') {
      const aEnt = a.entrances ?? Number.POSITIVE_INFINITY
      const bEnt = b.entrances ?? Number.POSITIVE_INFINITY
      cmp = aEnt - bEnt
    } else if (sortBy === 'durationDays') {
      const aDur = a.durationDays ?? Number.POSITIVE_INFINITY
      const bDur = b.durationDays ?? Number.POSITIVE_INFINITY
      cmp = aDur - bDur
    } else if (sortBy === 'createdAt') {
      cmp = a.createdAt.localeCompare(b.createdAt)
    } else {
      cmp = a.name.localeCompare(b.name, 'it')
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  return {
    subscriptions: filtered,
  }
})

