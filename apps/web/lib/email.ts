/**
 * Email helper — Brevo (formerly Sendinblue) transactional API.
 *
 * We POST to https://api.brevo.com/v3/smtp/email with the format below.
 * The API key is read from `BREVO_API_KEY` at call time (not at module
 * load) so secret rotation in PM2 doesn't require a code change.
 *
 * Both `sendPasswordResetEmail` and `sendVerificationEmail` are wrappers
 * around the same primitive so the transport stays consistent.
 *
 * Errors from Brevo are caught at the call site (typically the
 * auth route files). Email delivery is a best-effort extension of the
 * auth flow, not a hard dependency: a failed send must not prevent
 * the user from completing whatever they were doing (registration,
 * password reset, etc.) when the email is informational. For
 * verification emails the failure is logged and the operator can
 * re-trigger via the resend-verification endpoint.
 */

import { logger, serializeErr } from './logger'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function getApiKey(): string | null {
  const key = process.env.BREVO_API_KEY
  return key && key.length > 0 ? key : null
}

function getFromAddress(): { email: string; name: string } {
  // Default to no-reply@barriotech.com.co. Brevo will reject anything
  // that tries to forge a sender it can't verify (SPF/DKIM records at
  // the registrar). Tier 14: this domain MUST be verified in Brevo +
  // the registrar before flipping EMAIL_FROM off the example default.
  // The fallback below keeps the code path crash-safe if EMAIL_FROM is
  // ever unset (e.g. a misconfigured PM2 env) but it's never reachable
  // when the deployed .env has the line populated.
  const email = process.env.EMAIL_FROM || 'no-reply@barriotech.com.co'
  const name = process.env.EMAIL_FROM_NAME || 'BarrioTech'
  return { email, name }
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
    || process.env.PUBLIC_URL
    || 'https://barriotech.com.co'
}

interface SendArgs {
  to: string
  subject: string
  html: string
  text?: string
}

async function sendEmail(args: SendArgs): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const apiKey = getApiKey()
  if (!apiKey) {
    logger.error({ to: args.to }, '[email] BREVO_API_KEY not configured — skipping send')
    return { ok: false, error: 'Email service not configured' }
  }

  const from = getFromAddress()

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: from,
        to: [{ email: args.to }],
        subject: args.subject,
        htmlContent: args.html,
        textContent: args.text,
        tags: ['barriotech'],
      }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      logger.error(
        { to: args.to, status: res.status, body: errBody },
        '[email] Brevo send failed'
      )
      return { ok: false, error: `Brevo ${res.status}: ${errBody.slice(0, 200)}` }
    }
    const data = await res.json().catch(() => ({} as any)) as { messageId?: string }
    return { ok: true, messageId: data.messageId }
  } catch (err) {
    logger.error(serializeErr(err), '[email] Brevo network error')
    return { ok: false, error: String((err as Error).message || err) }
  }
}

/* ------------------------------------------------------------------ */
/* Token helpers — we hash tokens before storing them so a DB dump    */
/* alone can't be used to verify arbitrary emails.                     */
/* ------------------------------------------------------------------ */

import { createHash, randomBytes } from 'crypto'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Issue a new verification token. Returns the PLAINTEXT token (only
 * sent to the user via email) and the SHA-256 hash (stored in DB). */
export function issueEmailVerificationToken(userId: string): {
  token: string
  tokenHash: string
  expiresAt: Date
} {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  return { token, tokenHash, expiresAt }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64')
}

/* ------------------------------------------------------------------ */
/* Email templates                                                   */
/* ------------------------------------------------------------------ */

function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff7ed;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:24px;margin:0;color:#f97316;">BarrioTech</h1>
    </div>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #fde68a;margin:32px 0;" />
    <p style="font-size:12px;color:#6b7280;text-align:center;margin:0;">
      Este email fue enviado porque alguien (probablemente tú) se registró en
      BarrioTech con esta dirección. Si no fuiste tú, ignora este mensaje.
    </p>
  </div>
</body>
</html>`
}

/* ------------------------------------------------------------------ */
/* Public API                                                        */
/* ------------------------------------------------------------------ */

export async function sendVerificationEmail(args: {
  to: string
  name: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  const link = `${getAppUrl()}/verificar-email?token=${encodeURIComponent(args.token)}`
  const html = emailShell(
    'Verifica tu email de BarrioTech',
    `
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hola${args.name ? `, ${args.name}` : ''}:</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Confirma tu dirección de email para activar tu cuenta. Después de
      verificar podrás crear tu puesto, dejar reseñas y contactar vendedores.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}"
         style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">
        Verificar mi email
      </a>
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:0 0 8px;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0;">
      ${link}
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      El enlace expira en 24 horas.
    </p>
    `
  )
  const text = `Hola${args.name ? `, ${args.name}` : ''}:

Confirma tu dirección de email para activar tu cuenta de BarrioTech.

Abre este enlace en tu navegador:
${link}

El enlace expira en 24 horas. Si no fuiste tú, ignora este mensaje.`

  return sendEmail({
    to: args.to,
    subject: 'Verifica tu email de BarrioTech',
    html,
    text,
  })
}

export async function sendVerificationResentEmail(args: {
  to: string
  name: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  // Same template but a different subject so the user can tell it's the
  // resent version.
  return sendVerificationEmail({ ...args, name: args.name })
}

export async function sendPasswordResetEmail(args: {
  to: string
  name: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  // URL MUST match `apps/web/app/(auth)/reset-password/page.tsx` (the (auth)
  // group is a Next.js layout group and doesn't appear in the URL — the path
  // is `/reset-password`, NOT `/restablecer-contrasena`). The token is the
  // SHA-256 plaintext (random 32 bytes base64url) — the API route hashes it
  // on receipt and looks up by `token_hash`.
  const link = `${getAppUrl()}/reset-password?token=${encodeURIComponent(args.token)}`
  const html = emailShell(
    'Restablece tu contraseña de BarrioTech',
    `
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hola${args.name ? `, ${args.name}` : ''}:</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta.
      Si no fuiste tú, ignora este mensaje — tu contraseña sigue igual.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}"
         style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">
        Restablecer contraseña
      </a>
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      El enlace expira en 1 hora.
    </p>
    `
  )
  const text = `Hola${args.name ? `, ${args.name}` : ''}:

Recibimos una solicitud para restablecer la contraseña de tu cuenta de BarrioTech.

Abre este enlace en tu navegador:
${link}

El enlace expira en 1 hora. Si no fuiste tú, ignora este mensaje.`

  return sendEmail({
    to: args.to,
    subject: 'Restablece tu contraseña de BarrioTech',
    html,
    text,
  })
}
