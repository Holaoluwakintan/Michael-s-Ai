// api/_email.js - Email drafting & sending via Brevo SMTP or Gmail API for Michael AI.
// Allows Michael to send direct one-on-one emails through his existing Brevo account without breaking newsletters.

export const EMAIL_RE = /^\s*(?:send\s+(?:an?\s+)?(?:email|mail)\s+to|mail|email\s+to|email)\s+([^\s@]+@[^\s@]+\.[^\s@]+)\s*(?:about|saying|that|with\s+message)?\s*([\s\S]*)$/i;
export const GMAIL_REPLY_RE = /^\s*(?:reply\s+to\s+(?:mail|email)|reply\s+to)\s+(.+)$/i;
export const YES_RE = /^\s*(?:yes|send|send\s+it|go\s+ahead|proceed|do\s+it|confirm|yup|yeah)\s*[?.!]*\s*$/i;
export const CANCEL_RE = /^\s*(?:no|cancel|stop|drop|nevermind|don't\s+send|leave\s+it)\s*[?.!]*\s*$/i;

export const brevoOn = () => !!process.env.BREVO_API_KEY;
export const gmailOn = () => !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
export const emailOn = () => brevoOn() || gmailOn();

const SENDER_EMAIL = () => process.env.SENDER_EMAIL || 'michaelolaoluwagab@gmail.com';
const SENDER_NAME = () => process.env.SENDER_NAME || 'Olaoluwa Michael';

/**
 * Send an individual email directly via Brevo Transactional Email API (v3)
 */
export async function sendBrevoEmail({ to, subject, text, html }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured in Vercel.');
  }

  const payload = {
    sender: { name: SENDER_NAME(), email: SENDER_EMAIL() },
    to: [{ email: to }],
    subject: subject || 'Message from Olaoluwa Michael',
    textContent: text,
    htmlContent: html || `<p style="font-family:sans-serif;font-size:16px;line-height:1.6;color:#222;">${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p><p>With love,<br><strong>Olaoluwa Michael</strong></p>`
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Brevo send error: ${data.message || res.status}`);
  }
  return { ok: true, messageId: data.messageId, provider: 'brevo' };
}

/**
 * Gmail OAuth2 Access Token Refresh
 */
async function getGmailAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('Gmail token refresh failed.');
  return data.access_token;
}

/**
 * Send via Gmail API
 */
export async function sendGmailEmail({ to, subject, body, threadId }) {
  const token = await getGmailAccessToken();
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    body
  ];
  const rawMessage = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const payload = { raw: rawMessage };
  if (threadId) payload.threadId = threadId;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gmail send failed');
  return { ok: true, id: data.id, provider: 'gmail' };
}

/**
 * Unified dispatch: uses Brevo by default, or Gmail if configured
 */
export async function sendDirectEmail({ to, subject, body, threadId }) {
  if (brevoOn()) {
    return sendBrevoEmail({ to, subject, text: body });
  }
  if (gmailOn()) {
    return sendGmailEmail({ to, subject, body, threadId });
  }
  throw new Error('Neither BREVO_API_KEY nor Gmail API is configured.');
}

/**
 * Prompt instruction to draft a single direct email
 */
export function draftDirectEmailPrompt(to, topic) {
  return `You are drafting a personal email from Olaoluwa Michael ("Michael"), a Nigerian Christian author, creator and developer.
Write the email AS Michael to ${to}.
Topic/Instructions from Michael:
"""${topic || 'Friendly check-in / greeting'}"""

Style guidelines:
- Warm, polite, concise, professional yet personal.
- Clean paragraphs, no fluff, no corporate buzzwords.
- Sign off warmly as "With love,\nOlaoluwa Michael" or "Best regards,\nOlaoluwa Michael".

Return ONLY JSON:
{"subject": "Clear, relevant subject line", "body": "Full body of the email without placeholder brackets"}`;
}
