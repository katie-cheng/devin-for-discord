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
   */
  track(sessionId, threadId, devinUrl, userId) {
    this.sessions.set(sessionId, {
      threadId,
      devinUrl,
      userId,
      lastStatus: 'working',
      lastMessageCount: 0,
      lastPRUrl: null,
      interval: setInterval(() => this.poll(sessionId), POLL_INTERVAL_MS),
    });
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
      // Filter to only show Devin's messages (no user_id means it's from Devin)
      const devinMessages = newMessages.filter(m => !m.user_id);

      const toShow = devinMessages.slice(0, MAX_MESSAGES_PER_POLL);
      for (const msg of toShow) {
        const embed = new EmbedBuilder()
          .setDescription(truncate(msg.message, 4000))
          .setColor(0x5865F2)
          .setTimestamp(new Date(msg.timestamp))
          .setFooter({ text: 'Devin for Discord' });

        await thread.send({ embeds: [embed] });
      }

      if (devinMessages.length > MAX_MESSAGES_PER_POLL) {
        await thread.send({
          content: `*+ ${devinMessages.length - MAX_MESSAGES_PER_POLL} more update(s) — [view full session](${tracked.devinUrl})*`,
        });
      }

      tracked.lastMessageCount = data.messages.length;
    }

    // --- Status change ---
    if (status && status !== tracked.lastStatus) {
      // Don't post a separate status embed for terminal states — handled below
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
            `<@${tracked.userId}> Devin is blocked and may need input.\nReply with \`/devin-reply\` or [open session in Devin](${tracked.devinUrl})`
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
      this.stopTracking(sessionId);
    }
  }

  stopTracking(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (tracked) {
      clearInterval(tracked.interval);
      this.sessions.delete(sessionId);
      console.log(`[Sessions] Stopped tracking ${sessionId}`);
    }
  }

  /**
   * Look up which session belongs to a thread (reverse lookup).
   */
  getSessionByThread(threadId) {
    for (const [sessionId, data] of this.sessions.entries()) {
      if (data.threadId === threadId) return sessionId;
    }
    return null;
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
