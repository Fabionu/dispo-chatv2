import { Resend } from 'resend'
import { env } from '../env.js'
import { log } from '../util/log.js'

type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not_configured' | 'provider_error' }

let client: Resend | null = null

function resendClient(): Resend | null {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null
  client ??= new Resend(env.RESEND_API_KEY)
  return client
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function layout(preheader: string, heading: string, body: string, action: string, href: string) {
  const safeHref = escapeHtml(href)
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#0b0d10;color:#f5f7fa;font-family:Inter,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0d10">
      <tr><td align="center" style="padding:36px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#14171c;border:1px solid #272c34;border-radius:18px">
          <tr><td style="padding:28px">
            <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af">Dispo-chat</div>
            <h1 style="margin:20px 0 10px;font-size:25px;line-height:1.25">${escapeHtml(heading)}</h1>
            <div style="font-size:15px;line-height:1.65;color:#c5cad3">${body}</div>
            <div style="margin:26px 0">
              <a href="${safeHref}" style="display:inline-block;background:#f5f7fa;color:#0b0d10;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:999px">${escapeHtml(action)}</a>
            </div>
            <div style="font-size:12px;line-height:1.5;color:#7f8792">If the button does not work, copy this link:<br><a href="${safeHref}" style="color:#c5cad3;word-break:break-all">${safeHref}</a></div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

async function send(
  payload: { to: string; subject: string; html: string; text: string },
  idempotencyKey: string,
): Promise<SendResult> {
  const resend = resendClient()
  if (!resend) {
    log.warn('email_not_configured', { kind: idempotencyKey.split(':', 1)[0] })
    return { sent: false, reason: 'not_configured' }
  }

  try {
    const { data, error } = await resend.emails.send(
      {
        from: env.EMAIL_FROM,
        to: [payload.to],
        ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      },
      { idempotencyKey },
    )
    if (error || !data?.id) {
      log.error('email_provider_error', {
        kind: idempotencyKey.split(':', 1)[0],
        code: error?.name ?? 'unknown',
      })
      return { sent: false, reason: 'provider_error' }
    }
    return { sent: true, id: data.id }
  } catch (error) {
    log.error('email_provider_error', {
      kind: idempotencyKey.split(':', 1)[0],
      code: error instanceof Error ? error.name : 'unknown',
    })
    return { sent: false, reason: 'provider_error' }
  }
}

export function sendVerificationEmail(input: {
  to: string
  displayName: string
  verificationUrl: string
  tokenId: string
}) {
  const name = escapeHtml(input.displayName)
  return send(
    {
      to: input.to,
      subject: 'Confirm your Dispo-chat email',
      html: layout(
        'Confirm your email to activate your Dispo-chat account.',
        'Confirm your email',
        `<p style="margin:0">Hi ${name},</p><p style="margin:12px 0 0">Confirm this email address to activate your account. This link expires in 24 hours and can be used once.</p>`,
        'Confirm email',
        input.verificationUrl,
      ),
      text: `Hi ${input.displayName},\n\nConfirm your email to activate your Dispo-chat account. This link expires in 24 hours and can be used once:\n${input.verificationUrl}\n\nIf you did not create this account, you can ignore this email.`,
    },
    `verify:${input.tokenId}`,
  )
}

export function sendWorkspaceInviteEmail(input: {
  to: string
  inviterName: string
  companyName: string
  roleLabel: string
  inviteUrl: string
  inviteId: string
}) {
  return send(
    {
      to: input.to,
      subject: `${input.inviterName} invited you to ${input.companyName} on Dispo-chat`,
      html: layout(
        `You were invited to join ${input.companyName} on Dispo-chat.`,
        `Join ${input.companyName}`,
        `<p style="margin:0">${escapeHtml(input.inviterName)} invited you to join as <strong style="color:#f5f7fa">${escapeHtml(input.roleLabel)}</strong>.</p><p style="margin:12px 0 0">This invitation is tied to this email address, expires in 48 hours, and can be used once.</p>`,
        'Accept invitation',
        input.inviteUrl,
      ),
      text: `${input.inviterName} invited you to join ${input.companyName} as ${input.roleLabel} on Dispo-chat.\n\nAccept the invitation (valid for 48 hours):\n${input.inviteUrl}`,
    },
    `invite:${input.inviteId}`,
  )
}

