// api/_story.js - Persistent Story Bible, Character Tracking, and Narrative Continuity for Michael AI
import * as J from './_jobs.js';

export const STORY_CMD_RE = /^\s*(?:story|story\s+bible|story\s+status|plot|characters)\s*[?.!]*\s*$/i;
export const NEW_STORY_RE = /^\s*(?:new\s+story|start\s+story|set\s+story)\s+(.+)$/i;
export const UPDATE_CHAR_RE = /^\s*(?:character|char)\s+([a-zA-Z0-9_\s]+?)\s*:\s*(.+)$/i;

const DEFAULT_STORY = {
  title: 'Untitled Story',
  currentEpisode: 1,
  characters: {},
  plotHistory: [],
  openThreads: [],
  updatedAt: null
};

/**
 * Load story state for a user/owner
 */
export async function loadStory(owner = 'owner') {
  try {
    if (J.jobsOn()) {
      const s = await J.rpc('kv_get', { k: `story/${owner}.json` }, 5000);
      if (s) return { ...DEFAULT_STORY, ...s };
    }
  } catch (e) {
    console.log('[story] load error', e.message);
  }
  return { ...DEFAULT_STORY };
}

/**
 * Save story state for a user/owner
 */
export async function saveStory(owner = 'owner', story) {
  story.updatedAt = new Date().toISOString();
  try {
    if (J.jobsOn()) {
      await J.rpc('kv_put', { k: `story/${owner}.json`, v: story }, 5000);
    }
  } catch (e) {
    console.log('[story] save error', e.message);
  }
}

/**
 * Format story state into a clean WhatsApp overview card
 */
export function formatStoryOverview(story) {
  if (!story || !story.title || story.title === 'Untitled Story') {
    return '📖 *No active story tracked yet.*\nStart one with:\n_new story <Story Title>_\n\ne.g. _new story The Return of Brother Fire_';
  }

  const lines = [
    `📚 *Active Story: ${story.title}*`,
    `🎬 Current Progress: Episode ${story.currentEpisode || 1}`,
    ''
  ];

  const charEntries = Object.entries(story.characters || {});
  if (charEntries.length) {
    lines.push('👥 *Character Bible:*');
    for (const [name, desc] of charEntries.slice(0, 8)) {
      lines.push(`• *${name}*: ${typeof desc === 'string' ? desc : desc.traits || desc.status || ''}`);
    }
    lines.push('');
  }

  if (story.plotHistory && story.plotHistory.length) {
    lines.push('📜 *Recent Plot Milestones:*');
    for (const p of story.plotHistory.slice(-4)) {
      lines.push(`• ${p}`);
    }
    lines.push('');
  }

  if (story.openThreads && story.openThreads.length) {
    lines.push('❓ *Open Plot Threads / Cliffhangers:*');
    for (const t of story.openThreads.slice(-3)) {
      lines.push(`• ${t}`);
    }
    lines.push('');
  }

  lines.push('Commands:');
  lines.push('• _next episode_ - drafts the next episode from your Google Doc');
  lines.push('• _character <Name>: <update>_ - adds or updates a character');
  lines.push('• _new story <Title>_ - switches to a new story');

  return lines.join('\n');
}

/**
 * Generate narrative continuity block for the Gemini prompt
 */
export function storyContinuityContext(story) {
  if (!story || !story.title || story.title === 'Untitled Story') return '';

  const chars = Object.entries(story.characters || {})
    .map(([n, d]) => `- ${n}: ${typeof d === 'string' ? d : `${d.traits || ''} (${d.status || ''})`}`)
    .join('\n');

  const plot = (story.plotHistory || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const threads = (story.openThreads || []).map(t => `- ${t}`).join('\n');

  return `
# ACTIVE STORY BIBLE & CONTINUITY
Story Title: "${story.title}"
Episode to write: Episode ${story.currentEpisode || 1}

Key Characters:
${chars || '(None recorded yet; introduce naturally)'}

Story So Far (Maintain strict continuity with these past events):
${plot || '(Beginning of story)'}

Open Plot Threads & Cliffhangers (Advance or resolve these):
${threads || '(None)'}
`;
}
