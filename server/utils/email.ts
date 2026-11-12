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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseSenderAddress(rawFrom: string): { name: string; email: string } {
  const match = /^(.+?)\s*<([^>]+)>$/.exec(rawFrom.trim())
  if (match && match[1] && match[2]) {
    return {
      name: match[1].trim(),
      email: match[2].trim(),
    }
  }
  return {
    name: 'Palestra',
    email: rawFrom.trim(),
  }
}

/**
 * Sends a transactional email in Italian via Resend, Brevo, or logs to console / outbox in dev/test.
 */
export async function sendTransactionalEmail(
  event: H3Event | undefined,
  params: {
    to: string | string[]
    subject: string
    html: string
    text: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const sentAt = new Date().toISOString()
  sentEmailsOutbox.push({
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    sentAt,
  })

  const recipients = (Array.isArray(params.to) ? params.to : [params.to])
    .map((r) => r.trim())
    .filter((r) => r.length > 0)

  if (recipients.length === 0) {
    return { delivered: false, provider: 'console' }
  }

  const resendApiKey =
    (typeof event?.context?.cloudflare?.env?.RESEND_API_KEY === 'string'
      ? event.context.cloudflare.env.RESEND_API_KEY
      : undefined) ??
    (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : undefined)

  const brevoApiKey =
    (typeof event?.context?.cloudflare?.env?.BREVO_API_KEY === 'string'
      ? event.context.cloudflare.env.BREVO_API_KEY
      : undefined) ??
    (typeof process !== 'undefined' ? process.env?.BREVO_API_KEY : undefined)

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
        to: recipients,
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

  if (brevoApiKey && brevoApiKey.trim().length > 0) {
    const sender = parseSenderAddress(emailFrom)
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey.trim(),
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: recipients.map((email) => ({ email })),
        subject: params.subject,
        htmlContent: params.html,
        textContent: params.text,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Errore sconosciuto')
      console.error(`[Email] Invio tramite Brevo fallito (${response.status}): ${errorText}`)
      return { delivered: false, provider: 'brevo' }
    }

    return { delivered: true, provider: 'brevo' }
  }

  if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
    console.info(
      `[Email Dev Console] To: ${recipients.join(', ')} | Subject: ${params.subject}\n${params.text}`,
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
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
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
        <a href="${escapeHtml(params.recoverUrl)}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Reimposta password
        </a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">Oppure copia e incolla questo link nel browser:<br/>${escapeHtml(params.recoverUrl)}</p>
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

/**
 * Sends a notification email in Italian when a course's name or description is modified
 * and the manager chooses to notify enrolled users of ENROLLING/UPCOMING lessons
 * (SPECIFICATION.md lines 82-83, 450).
 */
export async function sendClassUpdatedEmail(
  event: H3Event | undefined,
  params: {
    to: string | string[]
    centerName: string
    previousName: string
    newName: string
    newDescription: string | null
    customMessage?: string | null
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const subject = `Aggiornamento corso "${params.newName}" - ${params.centerName}`
  const textLines = [
    `Gentile iscritto/a,`,
    '',
    `ti informiamo che il corso "${params.previousName}" presso la sede ${params.centerName} è stato aggiornato.`,
    `Nuovo nome del corso: ${params.newName}`,
  ]

  if (params.newDescription) {
    textLines.push(`Descrizione: ${params.newDescription}`)
  }

  if (params.customMessage && params.customMessage.trim().length > 0) {
    textLines.push('', 'Messaggio dalla direzione:', params.customMessage.trim())
  }

  const text = textLines.join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Aggiornamento corso</h2>
      <p>Gentile iscritto/a,</p>
      <p>ti informiamo che il corso <strong>${escapeHtml(params.previousName)}</strong> presso la sede <strong>${escapeHtml(params.centerName)}</strong> è stato aggiornato.</p>
      <ul>
        <li><strong>Nome del corso:</strong> ${escapeHtml(params.newName)}</li>
        ${params.newDescription ? `<li><strong>Descrizione:</strong> ${escapeHtml(params.newDescription)}</li>` : ''}
      </ul>
      ${
        params.customMessage && params.customMessage.trim().length > 0
          ? `<div style="margin-top: 16px; padding: 12px; background-color: #f3f4f6; border-radius: 6px;">
              <strong>Messaggio dalla direzione:</strong><br/>
              ${escapeHtml(params.customMessage.trim())}
            </div>`
          : ''
      }
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject,
    html,
    text,
  })
}

/**
 * Sends a welcome email in Italian with first-login credentials when a new global user account is created
 * (SPECIFICATION.md lines 123-126, 516).
 */
export async function sendWelcomeNewUserEmail(
  event: H3Event | undefined,
  params: {
    to: string
    name: string
    surname: string
    centerName: string
    temporaryPassword: string
    loginUrl: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const subject = `Benvenuto/a in ${params.centerName} - Credenziali di accesso`
  const text = [
    `Ciao ${params.name} ${params.surname},`,
    '',
    `Il tuo account per la sede ${params.centerName} è stato creato con successo.`,
    '',
    'Ecco le tue credenziali di primo accesso:',
    `Email: ${params.to}`,
    `Password temporanea: ${params.temporaryPassword}`,
    '',
    `Puoi accedere all'applicazione da qui: ${params.loginUrl}`,
    'Ti consigliamo di modificare la password dalle Impostazioni dopo il primo accesso.',
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Benvenuto/a in ${escapeHtml(params.centerName)}</h2>
      <p>Ciao <strong>${escapeHtml(params.name)} ${escapeHtml(params.surname)}</strong>,</p>
      <p>Il tuo account per la sede <strong>${escapeHtml(params.centerName)}</strong> è stato creato con successo.</p>
      <div style="margin: 16px 0; padding: 12px; background-color: #f3f4f6; border-radius: 6px;">
        <p style="margin: 0 0 8px 0;"><strong>Credenziali di primo accesso:</strong></p>
        <p style="margin: 0;"><strong>Email:</strong> ${escapeHtml(params.to)}</p>
        <p style="margin: 4px 0 0 0;"><strong>Password temporanea:</strong> <code>${escapeHtml(params.temporaryPassword)}</code></p>
      </div>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(params.loginUrl)}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Accedi ora
        </a>
      </p>
      <p style="font-size: 12px; color: #6b7280;">Ti consigliamo di modificare la password dalla sezione Impostazioni dopo il primo accesso.</p>
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject,
    html,
    text,
  })
}

/**
 * Sends an informational email in Italian when an existing platform user is enabled in a new center
 * (SPECIFICATION.md lines 127-129, 516).
 */
export async function sendCenterEnabledEmail(
  event: H3Event | undefined,
  params: {
    to: string
    name: string
    surname: string
    centerName: string
    loginUrl: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const subject = `Abilitazione nuova sede: ${params.centerName}`
  const text = [
    `Ciao ${params.name} ${params.surname},`,
    '',
    `Sei stato/a abilitato/a presso la sede ${params.centerName}.`,
    'Puoi accedere alla nuova sede utilizzando le tue credenziali abituali e selezionando la sede dalle Impostazioni.',
    '',
    `Accedi all'applicazione: ${params.loginUrl}`,
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Abilitazione nuova sede: ${escapeHtml(params.centerName)}</h2>
      <p>Ciao <strong>${escapeHtml(params.name)} ${escapeHtml(params.surname)}</strong>,</p>
      <p>Ti informiamo che il tuo account è stato abilitato presso la sede <strong>${escapeHtml(params.centerName)}</strong>.</p>
      <p>Puoi accedervi effettuando il login con le tue credenziali abituali.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(params.loginUrl)}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Accedi all'applicazione
        </a>
      </p>
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject,
    html,
    text,
  })
}

/**
 * Sends a new random password in Italian when a manager/assistant manager resets a user's password
 * (SPECIFICATION.md lines 399, 519).
 */
export async function sendAdminPasswordResetEmail(
  event: H3Event | undefined,
  params: {
    to: string
    name: string
    surname: string
    centerName: string
    newPassword: string
    loginUrl: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const subject = `Nuova password generata - ${params.centerName}`
  const text = [
    `Ciao ${params.name} ${params.surname},`,
    '',
    `La direzione della sede ${params.centerName} ha generato una nuova password per il tuo account.`,
    '',
    `Nuova password: ${params.newPassword}`,
    '',
    `Accedi qui: ${params.loginUrl}`,
    'Ti consigliamo di cambiare la password dalle Impostazioni dopo aver effettuato l’accesso.',
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Nuova password generata</h2>
      <p>Ciao <strong>${escapeHtml(params.name)} ${escapeHtml(params.surname)}</strong>,</p>
      <p>La direzione della sede <strong>${escapeHtml(params.centerName)}</strong> ha reimpostato la password del tuo account.</p>
      <div style="margin: 16px 0; padding: 12px; background-color: #f3f4f6; border-radius: 6px;">
        <p style="margin: 0;"><strong>Nuova password:</strong> <code>${escapeHtml(params.newPassword)}</code></p>
      </div>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(params.loginUrl)}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Accedi
        </a>
      </p>
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject,
    html,
    text,
  })
}

/**
 * Sends a custom communication email in Italian from a manager/assistant manager to one or more customers
 * (SPECIFICATION.md lines 23, 398-399, 520).
 */
export async function sendCustomUsersEmail(
  event: H3Event | undefined,
  params: {
    to: string | string[]
    centerName: string
    senderName: string
    subject?: string | null
    message: string
  },
): Promise<{ delivered: boolean; provider: 'resend' | 'brevo' | 'console' }> {
  const resolvedSubject =
    params.subject && params.subject.trim().length > 0
      ? `${params.subject.trim()} - ${params.centerName}`
      : `Comunicazione dalla sede ${params.centerName}`

  const text = [
    `Comunicazione da ${params.centerName} (${params.senderName}):`,
    '',
    params.message.trim(),
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #111827;">
      <h2>Comunicazione da ${escapeHtml(params.centerName)}</h2>
      <p style="color: #4b5563; font-size: 14px;">Inviato da: <strong>${escapeHtml(params.senderName)}</strong></p>
      <div style="margin-top: 16px; padding: 14px; background-color: #f9fafb; border-left: 4px solid #111827; white-space: pre-wrap;">${escapeHtml(params.message.trim())}</div>
    </div>
  `.trim()

  return sendTransactionalEmail(event, {
    to: params.to,
    subject: resolvedSubject,
    html,
    text,
  })
}
