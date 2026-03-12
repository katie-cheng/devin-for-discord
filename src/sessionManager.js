import { EmbedBuilder } from 'discord.js';
import { getSession } from './devin.js';

const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 15_000;
const FAST_POLL_DURATION = 120_000;
export const TERMINAL_STATUSES = new Set(['finished', 'expired']);
const WORKING_STATUSES = new Set(['working', 'resumed', 'resume_requested', 'resume_requested_frontend']);
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

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export class SessionManager {
  constructor(client) {
    this.client = client;
    this.sessions = new Map();
  }

  /**
   * Start tracking a session. Posts a "thinking" indicator, polls immediately,
   * then adaptively (5s for first 2 min, 15s after).
   */
  async track(sessionId, thread, devinUrl, userId, opts = {}) {
    // Clear any existing tracking for this session to prevent timer leaks
    if (this.sessions.has(sessionId)) {
      this.stopTracking(sessionId);
    }

    const thinkingEmbed = new EmbedBuilder()
      .setDescription('💭 **Devin is thinking...**')
      .setColor(0xFFAA00)
      .setFooter({ text: 'Devin for Discord' });

    const statusMessage = await thread.send({ embeds: [thinkingEmbed] });

    this.sessions.set(sessionId, {
      threadId: thread.id,
      devinUrl,
      userId,
      lastStatus: 'working',
      lastMessageCount: 0,
      lastPRUrl: null,
      muted: false,
      originalMessageId: opts.originalMessageId || null,
      originalChannelId: opts.originalChannelId || null,
      statusMessageId: statusMessage.id,
      thinkingStart: Date.now(),
      timeout: null,
    });

    this.pollAndSchedule(sessionId);
  }

  async pollAndSchedule(sessionId) {
    await this.poll(sessionId);

    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    const elapsed = Date.now() - tracked.thinkingStart;
    const delay = elapsed < FAST_POLL_DURATION ? FAST_POLL_MS : SLOW_POLL_MS;
    tracked.timeout = setTimeout(() => this.pollAndSchedule(sessionId), delay);
  }

  async poll(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    let data;
    try {
      data = await getSession(sessionId);
    } catch (err) {
      console.error(`[Poll] Error fetching session ${sessionId}: ${err.message}`);
      return;
    }

    let thread;
    try {
      thread = await this.client.channels.fetch(tracked.threadId);
    } catch (err) {
      console.error(`[Poll] Could not fetch thread: ${err.message}`);
      this.stopTracking(sessionId);
      return;
    }

    const status = data.status_enum || data.status;

    // --- New messages from Devin ---
    if (data.messages && data.messages.length > tracked.lastMessageCount) {
      const newMessages = data.messages.slice(tracked.lastMessageCount);
      const devinMessages = newMessages.filter(m => !m.user_id);

      // Show the most recent messages when truncating
      const skipped = Math.max(0, devinMessages.length - MAX_MESSAGES_PER_POLL);
      if (skipped > 0) {
        await thread.send({
          content: `*${skipped} earlier update(s) skipped — [view full session](${tracked.devinUrl})*`,
        });
      }

      for (const msg of devinMessages.slice(-MAX_MESSAGES_PER_POLL)) {
        const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
        const embed = new EmbedBuilder()
          .setDescription(truncate(msg.message, 4000))
          .setColor(0x5865F2)
          .setTimestamp(timestamp)
          .setFooter({ text: 'Devin for Discord' });
        await thread.send({ embeds: [embed] });
      }

      tracked.lastMessageCount = data.messages.length;

      // Devin responded — finalize thinking indicator
      if (tracked.statusMessageId && devinMessages.length > 0) {
        await this.finalizeThinking(tracked, '✅ **Responded**', 0x00CC00);
      }
    }

    // --- Status changes ---
    if (status && status !== tracked.lastStatus) {
      // Devin resumed working → show new thinking indicator
      if (WORKING_STATUSES.has(status) && !tracked.statusMessageId && !WORKING_STATUSES.has(tracked.lastStatus)) {
        const embed = new EmbedBuilder()
          .setDescription('💭 **Devin is thinking...**')
          .setColor(0xFFAA00)
          .setFooter({ text: 'Devin for Discord' });
        const msg = await thread.send({ embeds: [embed] });
        tracked.statusMessageId = msg.id;
        tracked.thinkingStart = Date.now();
      }

      // Blocked — finalize thinking (don't post a "blocked" embed)
      if (status === 'blocked' && tracked.statusMessageId) {
        await this.finalizeThinking(tracked, '✅ **Responded**', 0x00CC00);
      }

      tracked.lastStatus = status;
    }

    // --- Update thinking timer (only while active) ---
    if (tracked.statusMessageId) {
      await this.updateThinking(tracked);
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
        .addFields({ name: 'Session', value: `[View in Devin](${tracked.devinUrl})`, inline: true })
        .setTimestamp()
        .setFooter({ text: 'Devin for Discord' });

      if (data.title) embed.setDescription(data.title);
      if (data.pull_request?.url) {
        embed.addFields({ name: 'Pull Request', value: `[View PR](${data.pull_request.url})`, inline: true });
      }

      await thread.send({ embeds: [embed] });

      if (tracked.statusMessageId) {
        const label = status === 'finished' ? '✅ **Finished**' : '❌ **Expired**';
        const color = status === 'finished' ? 0x00CC00 : 0xCC0000;
        await this.finalizeThinking(tracked, label, color);
      }

      await this.reactOnOriginal(tracked, status === 'finished' ? '✅' : '❌');
      this.stopTracking(sessionId);
    }
  }

  /**
   * Update the thinking indicator with elapsed time.
   */
  async updateThinking(tracked) {
    try {
      const elapsed = Date.now() - tracked.thinkingStart;
      const embed = new EmbedBuilder()
        .setDescription(`💭 **Devin is thinking...** · ⏱️ ${formatElapsed(elapsed)}`)
        .setColor(0xFFAA00)
        .setFooter({ text: 'Devin for Discord' });
      const thread = await this.client.channels.fetch(tracked.threadId);
      const msg = await thread.messages.fetch(tracked.statusMessageId);
      await msg.edit({ embeds: [embed] });
    } catch (err) {
      // Ignore — message may have been deleted
    }
  }

  /**
   * Finalize the thinking indicator — show completion state.
   */
  async finalizeThinking(tracked, label, color) {
    try {
      const elapsed = Date.now() - tracked.thinkingStart;
      const embed = new EmbedBuilder()
        .setDescription(`${label} · ⏱️ ${formatElapsed(elapsed)}`)
        .setColor(color)
        .setFooter({ text: 'Devin for Discord' });
      const thread = await this.client.channels.fetch(tracked.threadId);
      const msg = await thread.messages.fetch(tracked.statusMessageId);
      await msg.edit({ embeds: [embed] });
    } catch (err) {
      // Ignore
    }
    tracked.statusMessageId = null;
  }

  async reactOnOriginal(tracked, emoji) {
    if (!tracked.originalMessageId) return;
    try {
      const channel = await this.client.channels.fetch(tracked.originalChannelId);
      const message = await channel.messages.fetch(tracked.originalMessageId);
      await message.react(emoji);
    } catch (err) {
      console.warn(`[Sessions] Could not react on original message: ${err.message}`);
    }
  }

  getTracked(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * User-initiated stop (EXIT, /devin-stop). Finalizes thinking + adds reaction.
   */
  async userStop(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    if (tracked.statusMessageId) {
      await this.finalizeThinking(tracked, '⏹️ **Stopped**', 0xCC0000);
    }

    await this.reactOnOriginal(tracked, '⏹️');
    this.stopTracking(sessionId);
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
