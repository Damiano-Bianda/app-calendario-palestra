import type { H3Event } from 'h3'

export interface TransactionalEmailMessage {
  to: string | string[]
  subject: string
  html: string
  text: string
  sentAt: string
}

/**
 * In-memory outbox of sent transactional emails (useful for development inspection and Vitest assertions).
 */
export const sentEmailsOutbox: TransactionalEmailMessage[] = []

export function clearSentEmailsOutbox(): void {
  sentEmailsOutbox.length = 0
}

/**
 * Sends a transactional email in Italian via Resend (or logs to console / outbox in dev/test).
 */
export async function sendTransactionalEmail(
  event: H3Event | undefined,
  params: {
    to: string | string[]
    subject: string
    html: string
    text: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'console' }> {
  const sentAt = new Date().toISOString()
  sentEmailsOutbox.push({
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    sentAt,
  })

  const resendApiKey =
    (typeof event?.context?.cloudflare?.env?.RESEND_API_KEY === 'string'
      ? event.context.cloudflare.env.RESEND_API_KEY
      : undefined) ??
    (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : undefined)

  const emailFrom =
    (typeof event?.context?.cloudflare?.env?.EMAIL_FROM === 'string'
      ? event.context.cloudflare.env.EMAIL_FROM
      : undefined) ??
    (typeof process !== 'undefined' ? process.env?.EMAIL_FROM : undefined) ??
    'Palestra <noreply@palestra.com>'

  if (resendApiKey && resendApiKey.trim().length > 0) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Errore sconosciuto')
      console.error(`[Email] Invio tramite Resend fallito (${response.status}): ${errorText}`)
      return { delivered: false, provider: 'resend' }
    }

    return { delivered: true, provider: 'resend' }
  }

  if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
    console.info(
      `[Email Dev Console] To: ${Array.isArray(params.to) ? params.to.join(', ') : params.to} | Subject: ${params.subject}\n${params.text}`,
    )
  }

  return { delivered: true, provider: 'console' }
}

/**
 * Sends the 30-minute stateless password recovery link in Italian.
 */
export async function sendPasswordRecoveryEmail(
  event: H3Event | undefined,
  params: {
    to: string
    recoverUrl: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'console' }> {
  const subject = 'Recupero password - Calendario Palestra'
  const text = [
    'Hai richiesto il recupero della password per il tuo account.',
    '',
    'Clicca sul seguente link entro 30 minuti per impostare una nuova password:',
    params.recoverUrl,
    '',
    'Se non hai richiesto tu il ripristino della password, puoi ignorare questa email.',
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Recupero password</h2>
      <p>Hai richiesto il recupero della password per il tuo account.</p>
      <p>Clicca sul pulsante qui sotto entro <strong>30 minuti</strong> per scegliere una nuova password:</p>
      <p style="margin: 24px 0;">
        <a href="${params.recoverUrl}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Reimposta password
        </a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">Oppure copia e incolla questo link nel browser:<br/>${params.recoverUrl}</p>
      <p style="font-size: 12px; color: #6b7280;">Se non hai richiesto tu il ripristino della password, puoi ignorare questa email.</p>
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject,
    html,
    text,
  })
}

