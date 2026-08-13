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
import {
  EMAIL_VERIFICATION_TTL_MS,
  EMAIL_VERIFICATION_TTL_LABEL,
  PASSWORD_RESET_TTL_LABEL,
} from './token-ttl'

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
  // Audit 2026-08-13 T19: route user replies to support instead of
  // bouncing on the no-reply sender. Configurable via env so the support
  // team can rotate addresses without a code change.
  const replyTo = {
    email: process.env.EMAIL_REPLY_TO || 'soporte@barriotech.com.co',
    name: 'Soporte BarrioTech',
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: from,
        replyTo,
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

// Audit 2026-08-13 M7: TTL now lives in lib/token-ttl.ts. Import only the
// constant here so the email template copy + the actual expiry share the
// same source of truth.

/** Issue a new verification token. Returns the PLAINTEXT token (only
 * sent to the user via email) and the SHA-256 hash (stored in DB). */
export function issueEmailVerificationToken(userId: string): {
  token: string
  tokenHash: string
  expiresAt: Date
} {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
  return { token, tokenHash, expiresAt }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64')
}

/* ------------------------------------------------------------------ */
/* Email templates                                                   */
/* ------------------------------------------------------------------ */

// Audit 2026-08-13 T3: business address required for CAN-SPAM, GDPR,
// Ley 1581/2012 compliance + Brevo spam-filter signal. Override via
// EMAIL_BUSINESS_ADDRESS env when the operator's registered address
// differs.
const BUSINESS_ADDRESS =
  process.env.EMAIL_BUSINESS_ADDRESS ||
  'BarrioTechT — Calle 100 #8-65, Bogotá D.C., Colombia'

// Audit 2026-08-13 T5: footer disclaimer is flow-aware. Verification
// emails say "registered", password resets say "requested a reset",
// generic fallback if a new flow is added without a label.
type FooterContext = 'register' | 'reset' | 'generic'
const FOOTER_DISCLAIMER: Record<FooterContext, string> = {
  register:
    'Este email fue enviado porque alguien (probablemente tú) se registró en BarrioTech con esta dirección. Si no fuiste tú, ignora este mensaje.',
  reset:
    'Este email fue enviado porque alguien (probablemente tú) solicitó restablecer la contraseña de su cuenta en BarrioTech. Si no fuiste tú, tu contraseña sigue igual — ignora este mensaje.',
  generic:
    'Este email fue enviado porque alguien usó esta dirección para una cuenta de BarrioTech. Si no fuiste tú, ignora este mensaje.',
}

// Audit 2026-08-13 T2: CTA button background orange-700 (4.7:1 vs white)
// passes WCAG AA. Body links use the same darker orange so any inline
// link copy inside the body also passes contrast.
const CTA_BG = '#c2410c'
const CTA_BG_HOVER_BORDER = '#9a3412'

function emailShell(opts: {
  title: string
  preheader: string
  bodyHtml: string
  footer: FooterContext
}): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${opts.title}</title>
  ${/* Audit 2026-08-13 T13: minimal dark-mode overrides. iOS Mail + Gmail
       dark mode otherwise leave the orange-50 background and slate-800
       text as-is and produce unreadable text. Use prefers-color-scheme:
       dark to invert the bg/fg/border colors. mso-hide keeps Outlook
       desktop from applying the block. */ ''}
  <style>
    @media (prefers-color-scheme: dark) {
      .email-body { background:#1c1917 !important; color:#f5f5f4 !important; }
      .email-card { background:#292524 !important; color:#f5f5f4 !important; border-color:#44403c !important; }
      .email-muted { color:#a8a29e !important; }
      .email-hr { border-color:#44403c !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff7ed;color:#1f2937;">
  ${/* Audit 2026-08-13 T4: hidden preheader that inbox clients use as
       preview text. Without this, Gmail/Outlook show the footer disclaimer
       in the inbox preview. */ ''}
  <span style="display:none;font-size:1px;color:#fff7ed;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${opts.preheader}
  </span>
  ${/* Audit 2026-08-13 T21: role=presentation on the outer wrapper so
       SR skip the chrome and read only the body content. */ ''}
  <div role="presentation" style="max-width:560px;margin:0 auto;padding:32px 24px;" class="email-card">
    <div role="presentation" style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:24px;margin:0;color:#f97316;">BarrioTech</h1>
    </div>
    ${opts.bodyHtml}
    <hr class="email-hr" style="border:none;border-top:1px solid #fde68a;margin:32px 0;" />
    <p class="email-muted" style="font-size:12px;color:#6b7280;text-align:center;margin:0 0 8px;">
      ¿Problemas? Escríbenos a <a href="mailto:soporte@barriotech.com.co" style="color:${CTA_BG};text-decoration:underline;">soporte@barriotech.com.co</a>
    </p>
    <p class="email-muted" style="font-size:12px;color:#6b7280;text-align:center;margin:0 0 8px;">
      ${BUSINESS_ADDRESS}
    </p>
    <p class="email-muted" style="font-size:12px;color:#6b7280;text-align:center;margin:0;">
      ${FOOTER_DISCLAIMER[opts.footer]}
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
  /** When true, copy indicates this is a re-send (the previous link is invalidated). */
  isResend?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const link = `${getAppUrl()}/verificar-email?token=${encodeURIComponent(args.token)}`
  const safeName = typeof args.name === 'string' && args.name.trim().length > 0 ? args.name.trim() : ''
  // Audit 2026-08-13 T1: greeting must not render "Hola:" with dangling
  // colon when name is empty/null.
  const greeting = safeName ? `Hola, ${safeName}` : 'Hola'
  // Audit 2026-08-13 T7: distinguish resend so the user can tell the
  // difference from a stale first email and so support can debug
  // "did the second email actually send?".
  const resendNote = args.isResend
    ? '<p style="font-size:14px;color:#6b7280;line-height:1.5;margin:0 0 16px;">Reenviamos este enlace porque lo solicitaste. El enlace anterior ya no es válido.</p>'
    : ''
  const html = emailShell({
    title: `Verifica tu email — expira en ${EMAIL_VERIFICATION_TTL_LABEL}`,
    preheader: `Confirma tu email para activar tu cuenta de BarrioTech. El enlace expira en ${EMAIL_VERIFICATION_TTL_LABEL}.`,
    footer: 'register',
    bodyHtml: `
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">${greeting}</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Confirma tu dirección de email para activar tu cuenta. Después de
      verificar podrás crear tu puesto, dejar reseñas y contactar vendedores.
    </p>
    ${resendNote}
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}"
         style="display:inline-block;background:${CTA_BG};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;border:1px solid ${CTA_BG_HOVER_BORDER};">
        Verificar mi email
      </a>
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:16px 0 8px;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0;overflow-wrap:anywhere;">
      ${link}
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      El enlace expira en ${EMAIL_VERIFICATION_TTL_LABEL}.
    </p>
    `,
  })
  const text = `${greeting}:

Confirma tu dirección de email para activar tu cuenta de BarrioTech.

Abre este enlace en tu navegador:
${link}

El enlace expira en ${EMAIL_VERIFICATION_TTL_LABEL}. Si no fuiste tú, ignora este mensaje.`

  // Audit 2026-08-13 T6: tighter subject line — brand in sender name, not
  // subject. Adds urgency.
  return sendEmail({
    to: args.to,
    subject: args.isResend
      ? `Reenvío: verifica tu email — expira en ${EMAIL_VERIFICATION_TTL_LABEL}`
      : `Verifica tu email — expira en ${EMAIL_VERIFICATION_TTL_LABEL}`,
    html,
    text,
  })
}

export async function sendVerificationResentEmail(args: {
  to: string
  name: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  // Audit 2026-08-13 T7: now passes isResend=true so the body and
  // subject say "(reenvío)" — distinguishes from a stale first email.
  return sendVerificationEmail({ ...args, isResend: true })
}

export async function sendPasswordResetEmail(args: {
  to: string
  name: string
  token: string
  /** Optional requesting context for the security-signal line. Caller
   * passes req.headers. Never use the raw IP for anything user-visible;
   * mask the last octet to avoid doxxing the user. */
  requestIp?: string
  userAgent?: string
}): Promise<{ ok: boolean; error?: string }> {
  // URL MUST match `apps/web/app/(auth)/reset-password/page.tsx` (the (auth)
  // group is a Next.js layout group and doesn't appear in the URL — the path
  // is `/reset-password`, NOT `/restablecer-contrasena`). The token is the
  // SHA-256 plaintext (random 32 bytes base64url) — the API route hashes it
  // on receipt and looks up by `token_hash`.
  const link = `${getAppUrl()}/reset-password?token=${encodeURIComponent(args.token)}`
  const safeName = typeof args.name === 'string' && args.name.trim().length > 0 ? args.name.trim() : ''
  const greeting = safeName ? `Hola, ${safeName}` : 'Hola'

  // Audit 2026-08-13 T9: security signal — IP (last octet masked) +
  // browser + timestamp. Lets the user distinguish the real email from
  // a phishing attempt. Mask is for the user's own privacy (full IP in
  // email body is doxxing if forwarded).
  const maskedIp = args.requestIp
    ? args.requestIp.replace(/\.\d+$/, '.***')
    : null
  const browser = args.userAgent && args.userAgent.length > 0
    ? args.userAgent.split(') ')[0].split('(')[1] || args.userAgent.slice(0, 80)
    : null
  const securityLine = maskedIp || browser
    ? `<p style="font-size:12px;color:#6b7280;background:#fffbeb;padding:12px;border-radius:6px;margin:16px 0;">
        <strong>¿No fuiste tú?</strong> Esta solicitud vino desde
        ${maskedIp ? `IP <code>${maskedIp}</code>` : 'una IP desconocida'}${browser ? ` usando ${browser}` : ''}.
        Si no la reconoces, ignora este mensaje — tu contraseña sigue igual.
        Si la reconoces pero no la solicitaste, contáctanos a
        <a href="mailto:soporte@barriotech.com.co" style="color:${CTA_BG};">soporte@barriotech.com.co</a>.
      </p>`
    : ''

  const html = emailShell({
    title: `Restablece tu contraseña — expira en ${PASSWORD_RESET_TTL_LABEL}`,
    preheader: `Restablece tu contraseña de BarrioTech. El enlace expira en ${PASSWORD_RESET_TTL_LABEL}.`,
    footer: 'reset',
    bodyHtml: `
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">${greeting}</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta.
      Si no fuiste tú, ignora este mensaje — tu contraseña sigue igual.
    </p>
    ${securityLine}
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}"
         style="display:inline-block;background:${CTA_BG};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;border:1px solid ${CTA_BG_HOVER_BORDER};">
        Restablecer mi contraseña
      </a>
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:16px 0 8px;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0;overflow-wrap:anywhere;">
      ${link}
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      El enlace expira en ${PASSWORD_RESET_TTL_LABEL}.
    </p>
    `,
  })
  const text = `${greeting}:

Recibimos una solicitud para restablecer la contraseña de tu cuenta de BarrioTech.

Abre este enlace en tu navegador:
${link}

El enlace expira en ${PASSWORD_RESET_TTL_LABEL}. Si no fuiste tú, ignora este mensaje.`

  return sendEmail({
    to: args.to,
    // Audit 2026-08-13 T6: tighter subject.
    subject: 'Restablece tu contraseña — expira en 1 hora',
    html,
    text,
  })
}
