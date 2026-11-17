// api/_episode.js - Google Docs text extraction, episode framing, and serial drafts
import * as G from './_gem.js';

export const EPISODE_RE = /^\s*(?:make|write|draft|create|next)?\s*(?:an?\s+)?episode\s*(?:from|for)?\s*(.*)$/i;
export const DOC_LINK_RE = /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i;

/**
 * Extract Document ID from any Google Doc URL
 */
export function extractDocId(url) {
  const m = String(url || '').match(DOC_LINK_RE);
  return m ? m[1] : null;
}

/**
 * Fetch plain text from a shared Google Doc without API keys.
 * Works for docs with "Anyone with the link can view".
 */
export async function fetchDocText(urlOrId) {
  const docId = extractDocId(urlOrId) || urlOrId;
  if (!docId) throw new Error('Invalid Google Doc link or ID.');

  // Direct plain-text export endpoint provided natively by Google Docs
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  
  const res = await fetch(exportUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(20000)
  });

  if (res.status === 404) {
    throw new Error('Google Doc not found. Make sure the link is correct.');
  }
  if (!res.ok) {
    throw new Error('Could not access document. Please set link sharing to "Anyone with the link can view".');
  }

  const rawText = await res.text();
  const cleaned = rawText
    .replace(/^\uFEFF/, '') // remove BOM
    .replace(/\r\n/g, '\n')
    .trim();

  if (!cleaned) throw new Error('The Google Doc is empty.');
  return { id: docId, text: cleaned };
}

/**
 * Create prompt instructions for Gemini to draft the episode
 */
export function episodePrompt(docText, instructions = '', episodeNumber = null, storyContext = '') {
  return `You are Michael AI, writing an episodic story or devotional episode for Olaoluwa Michael ("Michael").
Write in Michael's signature storytelling voice:
- Warm, vivid, relatable Nigerian storytelling with faith and human insight.
- One thought per line rhythm, dialogue in quotes, balanced landing couplet.
- Authentic Nigerian setting, gentle humor, and deep spiritual truth.

${storyContext ? storyContext + '\n' : ''}Source Material from Michael's Google Doc:
"""
${docText.slice(0, 25000)}
"""

Specific instructions:
${instructions ? `"""${instructions}"""` : 'Pick the next logical episode/scene from the text above and craft it into a complete, captivating episode.'}
${episodeNumber ? `Episode Number: ${episodeNumber}` : ''}

Format your output in clean WhatsApp markdown:
- Title: 🎬 *Episode [X]: [Title]*
- Body of the episode (suitable for WhatsApp channel, Facebook, or newsletter reading)
- Takeaway / closing punchline line`;
}
