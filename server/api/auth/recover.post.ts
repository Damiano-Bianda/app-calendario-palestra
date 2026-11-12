import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { recoverPasswordSchema } from '../../../shared/schemas/auth.ts'
import { users } from '../../db/schema.ts'
import { readValidatedBodyWithZod, useAppUrl, useAuthSecret } from '../../utils/auth.ts'
import { createRecoveryToken } from '../../utils/crypto.ts'
import { useDb } from '../../utils/db.ts'
import { sendPasswordRecoveryEmail } from '../../utils/email.ts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBodyWithZod(event, recoverPasswordSchema)
  const db = useDb(event)

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, body.email), isNull(users.deletedAt)),
  })

  if (user) {
    const secret = useAuthSecret(event)
    const token = await createRecoveryToken(
      {
        userId: user.id,
        passwordHash: user.passwordHash,
      },
      secret,
    )
    const appUrl = useAppUrl(event)
    const recoverUrl = `${appUrl}/recover?token=${encodeURIComponent(token)}`

    await sendPasswordRecoveryEmail(event, {
      to: user.email,
      recoverUrl,
    })
  }

  return {
    success: true,
    message:
      "Se l'indirizzo email è associato a un account attivo, riceverai un link per reimpostare la password.",
  }
})

