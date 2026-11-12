import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { sendUsersEmailSchema } from '../../../shared/schemas/users.ts'
import { users, usersCenters } from '../../db/schema.ts'
import { readValidatedBodyWithZod, requireManagerOrAssistant } from '../../utils/auth.ts'
import { useDb } from '../../utils/db.ts'
import { sendCustomUsersEmail } from '../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const auth = requireManagerOrAssistant(event)
  const body = await readValidatedBodyWithZod(event, sendUsersEmailSchema)
  const db = useDb(event)

  const targetRows = await db
    .select({
      userId: users.id,
      email: users.email,
    })
    .from(usersCenters)
    .innerJoin(users, eq(usersCenters.userId, users.id))
    .where(
      and(
        eq(usersCenters.centerId, auth.centerId),
        inArray(usersCenters.userId, body.userIds),
        isNull(usersCenters.deletedAt),
        isNull(users.deletedAt),
      ),
    )

  if (targetRows.length !== body.userIds.length) {
    throw createError({
      statusCode: 400,
      message: 'Uno o più destinatari selezionati non appartengono alla sede attiva.',
    })
  }

  const recipientEmails = Array.from(new Set(targetRows.map((r) => r.email)))

  await sendCustomUsersEmail(event, {
    to: recipientEmails,
    centerName: auth.centerName,
    senderName: `${auth.name} ${auth.surname}`,
    subject: body.subject ?? null,
    message: body.message,
  })

  return {
    success: true,
    sentCount: recipientEmails.length,
  }
})

