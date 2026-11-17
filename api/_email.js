// api/_email.js - Email search, drafting, and sending via Gmail API for Michael AI.
// Follows the same modular architecture as _newsletter.js and _sow.js.

export const EMAIL_RE = /^\s*(?:reply\s+to\s+mail|reply\s+to\s+email|reply\s+to|send\s+(?:an?\s+)?email\s+to|mail)\s+(.+)$/i;
export const CHECK_MAIL_RE = /^\s*(?:check\s+(?:my\s+)?(?:mails?|emails?)|recent\s+emails?|inbox)\s*[?.!]*\s*$/i;
export const YES_RE = /^\s*(?:yes|send|send\s+it|go\s+ahead|proceed|do\s+it|confirm|yup|yeah)\s*[?.!]*\s*$/i;
export const CANCEL_RE = /^\s*(?:no|cancel|stop|drop|nevermind|don't\s+send|leave\s+it)\s*[?.!]*\s*$/i;

export const emailOn = () => !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);

/**
 * Obtain a fresh Google OAuth2 access token using the refresh token
 */
async function getAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail API credentials missing in environment.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to refresh Gmail token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/**
 * Search the user's Gmail inbox for messages matching query (sender name, email, or keywords)
 */
export async function searchEmails(query, max = 5) {
  const token = await getAccessToken();
  const q = encodeURIComponent(`to:me ${query}`);
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  if (!listData.messages || !listData.messages.length) return [];

  const emails = [];
  for (const item of listData.messages) {
    const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const msg = await msgRes.json();
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    // Extract text body
    let body = '';
    if (msg.snippet) body = msg.snippet;
    const parts = msg.payload?.parts || [];
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8');
        break;
      }
    }

    emails.push({
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: msg.snippet,
      body: body.slice(0, 4000)
    });
  }
  return emails;
}

/**
 * Construct RFC 2822 email payload and send via Gmail API
 */
export async function sendEmail({ to, subject, body, inReplyTo, threadId }) {
  const token = await getAccessToken();
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`
  ];

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
    messageParts.push(`References: ${inReplyTo}`);
  }

  messageParts.push('', body);
  const rawMessage = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const payload = { raw: rawMessage };
  if (threadId) payload.threadId = threadId;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail send error: ${data.error?.message || res.status}`);
  }
  return { ok: true, id: data.id, threadId: data.threadId };
}

/**
 * Generate prompt instructions for Gemini to draft a reply in Michael's voice
 */
export function draftReplyPrompt(targetEmail, instructions) {
  return `You are drafting an email reply for Olaoluwa Michael ("Michael"), a Nigerian Christian author, creator and developer.
Write the reply AS Michael in his authentic, warm, polite, and direct communication style.

Original Email Received:
- From: ${targetEmail.from}
- Subject: ${targetEmail.subject}
- Date: ${targetEmail.date}
- Content:
"""
${targetEmail.body || targetEmail.snippet}
"""

Instructions from Michael on what to say:
"""${instructions}"""

Output JSON only in this exact format:
{
  "subject": "Re: ${targetEmail.subject.replace(/^Re:\s*/i, '')}",
  "body": "The complete draft of the email reply text without placeholder brackets"
}`;
}
