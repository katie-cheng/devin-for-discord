/**
 * Centralized configuration for the Devin Discord bot.
 *
 * Tune polling intervals, embed appearance, thread defaults, and
 * Devin API settings in one place instead of hunting through source files.
 */

// --- Devin API ---
export const DEVIN_API_BASE_URL = 'https://api.devin.ai/v1';

// --- Polling ---
export const FAST_POLL_MS = 5_000;          // Poll interval while session is fresh
export const SLOW_POLL_MS = 15_000;         // Poll interval after FAST_POLL_DURATION
export const FAST_POLL_DURATION = 120_000;  // How long to use the fast interval (ms)
export const MAX_MESSAGES_PER_POLL = 5;     // Max Devin messages forwarded per poll cycle

// --- Discord threads ---
export const THREAD_AUTO_ARCHIVE_DURATION = 1440; // Minutes before Discord auto-archives (1440 = 24h)
export const THREAD_NAME_MAX_LENGTH = 100;         // Discord thread name limit

// --- Embeds ---
export const EMBED_COLORS = {
  working:  0xFFAA00,  // Yellow
  blocked:  0xFF6600,  // Orange
  finished: 0x00CC00,  // Green
  expired:  0xCC0000,  // Red
  resumed:  0xFFAA00,  // Yellow
  suspend:  0x888888,  // Grey
  resume:   0xFFAA00,  // Yellow
  default:  0x888888,  // Grey — fallback
  devinMsg: 0x5865F2,  // Blurple — messages from Devin
  pr:       0x238636,  // GitHub green — PR embeds
  stopped:  0xCC0000,  // Red — user-terminated
};

export const EMBED_FOOTER_TEXT = 'Devin for Discord';

// --- Message truncation ---
export const MAX_EMBED_DESCRIPTION_LENGTH = 4000;

// --- Session statuses ---
export const TERMINAL_STATUSES = new Set(['finished', 'expired']);
export const WORKING_STATUSES = new Set([
  'working',
  'resumed',
  'resume_requested',
  'resume_requested_frontend',
]);

export const STATUS_DISPLAY = {
  working:                    { color: EMBED_COLORS.working,  emoji: '🟡', label: 'Working' },
  blocked:                    { color: EMBED_COLORS.blocked,  emoji: '🟠', label: 'Blocked' },
  finished:                   { color: EMBED_COLORS.finished, emoji: '🟢', label: 'Finished' },
  expired:                    { color: EMBED_COLORS.expired,  emoji: '🔴', label: 'Expired' },
  resumed:                    { color: EMBED_COLORS.resumed,  emoji: '🟡', label: 'Resumed' },
  suspend_requested:          { color: EMBED_COLORS.suspend,  emoji: '⏸️', label: 'Suspending' },
  suspend_requested_frontend: { color: EMBED_COLORS.suspend,  emoji: '⏸️', label: 'Suspending' },
  resume_requested:           { color: EMBED_COLORS.resume,   emoji: '▶️', label: 'Resuming' },
  resume_requested_frontend:  { color: EMBED_COLORS.resume,   emoji: '▶️', label: 'Resuming' },
};
