import { EmbedBuilder } from 'discord.js';
import { getSession } from './devin.js';

const POLL_INTERVAL_MS = 30_000;
const TERMINAL_STATUSES = new Set(['finished', 'expired']);
const MAX_MESSAGES_PER_POLL = 5;

const STATUS_DISPLAY = {
  working:   { color: 0xFFAA00, emoji: '🟡', label: 'Working' },
  blocked:   { color: 0xFF6600, emoji: '🟠', label: 'Blocked' },
  finished:  { color: 0x00CC00, emoji: '🟢', label: 'Finished' },
  expired:   { color: 0xCC0000, emoji: '🔴', label: 'Expired' },
  resumed:   { color: 0xFFAA00, emoji: '🟡', label: 'Resumed' },
  suspend_requested:          { color: 0x888888, emoji: '⏸️', label: 'Suspending' },
  suspend_requested_frontend: { color: 0x888888, emoji: '⏸️', label: 'Suspending' },
  resume_requested:           { color: 0xFFAA00, emoji: '▶️', label: 'Resuming' },
  resume_requested_frontend:  { color: 0xFFAA00, emoji: '▶️', label: 'Resuming' },
};

function getStatusDisplay(status) {
  return STATUS_DISPLAY[status] || { color: 0x888888, emoji: '⚪', label: status };
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + '\n\n*[Truncated]*';
}

export class SessionManager {
  constructor(client) {
    this.client = client;
    this.sessions = new Map(); // session_id -> tracked state
  }

  /**
   * Start tracking a Devin session — poll every 30s and post updates to the thread.
   * opts.originalMessageId / opts.originalChannelId — for adding reactions to the trigger message.
   */
  track(sessionId, threadId, devinUrl, userId, opts = {}) {
    // Clear any existing tracking for this session to prevent interval leaks
    if (this.sessions.has(sessionId)) {
      this.stopTracking(sessionId);
    }

    const tracked = {
      threadId,
      devinUrl,
      userId,
      lastStatus: 'working',
      lastMessageCount: 0,
      lastPRUrl: null,
      muted: false,
      polling: false,
      originalMessageId: opts.originalMessageId || null,
      originalChannelId: opts.originalChannelId || null,
      timeout: null,
    };

    this.sessions.set(sessionId, tracked);
    this._schedulePoll(sessionId);
  }

  _schedulePoll(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    tracked.timeout = setTimeout(async () => {
      await this.poll(sessionId);
      // Schedule next poll only if still tracked (not stopped during poll)
      if (this.sessions.has(sessionId)) {
        this._schedulePoll(sessionId);
      }
    }, POLL_INTERVAL_MS);
  }

  async poll(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    let data;
    try {
      data = await getSession(sessionId);
    } catch (err) {
      console.error(`[Poll] Error fetching session ${sessionId}: ${err.message}`);
      return; // Don't crash — retry on next interval
    }

    let thread;
    try {
      thread = await this.client.channels.fetch(tracked.threadId);
    } catch (err) {
      console.error(`[Poll] Could not fetch thread ${tracked.threadId}: ${err.message}`);
      this.stopTracking(sessionId);
      return;
    }

    const status = data.status_enum || data.status;

    // --- New messages from Devin ---
    if (data.messages && data.messages.length > tracked.lastMessageCount) {
      const newMessages = data.messages.slice(tracked.lastMessageCount);
      const devinMessages = newMessages.filter(m => !m.user_id);

      // Show the most recent messages (not the oldest) when truncating
      const skipped = Math.max(0, devinMessages.length - MAX_MESSAGES_PER_POLL);
      if (skipped > 0) {
        await thread.send({
          content: `*${skipped} earlier update(s) skipped — [view full session](${tracked.devinUrl})*`,
        });
      }

      const toShow = devinMessages.slice(-MAX_MESSAGES_PER_POLL);
      for (const msg of toShow) {
        const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
        const embed = new EmbedBuilder()
          .setDescription(truncate(msg.message, 4000))
          .setColor(0x5865F2)
          .setTimestamp(timestamp)
          .setFooter({ text: 'Devin for Discord' });

        await thread.send({ embeds: [embed] });
      }

      tracked.lastMessageCount = data.messages.length;
    }

    // --- Status change ---
    if (status && status !== tracked.lastStatus) {
      if (!TERMINAL_STATUSES.has(status)) {
        const display = getStatusDisplay(status);
        const embed = new EmbedBuilder()
          .setTitle(`${display.emoji} Status: ${display.label}`)
          .setColor(display.color)
          .addFields({ name: 'Session', value: `[View in Devin](${tracked.devinUrl})` })
          .setTimestamp()
          .setFooter({ text: 'Devin for Discord' });

        if (status === 'blocked') {
          embed.setDescription(
            `<@${tracked.userId}> Devin is blocked and may need input.\nReply in this thread or [open session in Devin](${tracked.devinUrl})`
          );
        }

        await thread.send({ embeds: [embed] });
      }

      tracked.lastStatus = status;
    }

    // --- PR created ---
    if (data.pull_request?.url && data.pull_request.url !== tracked.lastPRUrl) {
      const embed = new EmbedBuilder()
        .setTitle('🔗 Pull Request Created')
        .setColor(0x238636)
        .setDescription(`[View Pull Request](${data.pull_request.url})`)
        .setTimestamp()
        .setFooter({ text: 'Devin for Discord' });

      await thread.send({ embeds: [embed] });
      tracked.lastPRUrl = data.pull_request.url;
    }

    // --- Terminal state ---
    if (TERMINAL_STATUSES.has(status)) {
      const display = getStatusDisplay(status);
      const embed = new EmbedBuilder()
        .setTitle(`${display.emoji} Session ${display.label}`)
        .setColor(display.color)
        .addFields(
          { name: 'Session', value: `[View in Devin](${tracked.devinUrl})`, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Devin for Discord' });

      if (data.title) {
        embed.setDescription(data.title);
      }
      if (data.pull_request?.url) {
        embed.addFields({ name: 'Pull Request', value: `[View PR](${data.pull_request.url})`, inline: true });
      }

      await thread.send({ embeds: [embed] });

      // React on the original trigger message (if created via @mention)
      await this.reactOnOriginal(tracked, status === 'finished' ? '✅' : '❌');

      this.stopTracking(sessionId);
    }
  }

  /**
   * Add a reaction to the original message that triggered the session.
   */
  async reactOnOriginal(tracked, emoji) {
    if (!tracked.originalMessageId) return;
    try {
      const channel = await this.client.channels.fetch(tracked.originalChannelId);
      const message = await channel.messages.fetch(tracked.originalMessageId);
      await message.react(emoji);
    } catch (err) {
      // Message may have been deleted — ignore
    }
  }

  stopTracking(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (tracked) {
      clearTimeout(tracked.timeout);
      this.sessions.delete(sessionId);
      console.log(`[Sessions] Stopped tracking ${sessionId}`);
    }
  }

  stopAll() {
    for (const sessionId of this.sessions.keys()) {
      this.stopTracking(sessionId);
    }
  }

  getSessionByThread(threadId) {
    for (const [sessionId, data] of this.sessions.entries()) {
      if (data.threadId === threadId) return sessionId;
    }
    return null;
  }

  setMuted(sessionId, muted) {
    const tracked = this.sessions.get(sessionId);
    if (tracked) tracked.muted = muted;
  }

  isMuted(sessionId) {
    return this.sessions.get(sessionId)?.muted ?? false;
  }

  getActiveSessions() {
    return Array.from(this.sessions.entries()).map(([id, data]) => ({
      sessionId: id,
      threadId: data.threadId,
      status: data.lastStatus,
      userId: data.userId,
    }));
  }
}
