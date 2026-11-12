import { defineEventHandler } from 'h3'
import { uuidv7 } from 'uuidv7'
import { createClassSchema } from '../../../shared/schemas/classes.ts'
import { classes } from '../../db/schema.ts'
import { readValidatedBodyWithZod, requireManagerOrAssistant } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, createClassSchema)
  const db = useDb(event)
  const now = new Date().toISOString()

  const newClass = {
    id: uuidv7(),
    centerId: auth.centerId,
    name: body.name.trim(),
    description: body.description ? body.description.trim() : null,
    color: body.color,
    createdBy: auth.userId,
    updatedBy: auth.userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  await db.insert(classes).values(newClass)

  return {
    class: newClass,
  }
})

