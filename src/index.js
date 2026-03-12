import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createSession, sendMessage, terminateSession, uploadAttachment } from './devin.js';
import { SessionManager } from './sessionManager.js';
import { TEMPLATES, getTemplate } from './templates.js';
import {
  TERMINAL_STATUSES,
  EMBED_COLORS,
  EMBED_FOOTER_TEXT,
  THREAD_AUTO_ARCHIVE_DURATION,
  THREAD_NAME_MAX_LENGTH,
} from './config.js';

// --- Validate env ---
const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DEVIN_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// --- Client setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const sessionManager = new SessionManager(client);

// --- Slash command definitions ---
const commands = [
  new SlashCommandBuilder()
    .setName('devin')
    .setDescription('Start a new Devin coding session')
    .addStringOption(opt =>
      opt.setName('task')
        .setDescription('What should Devin work on?')
        .setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('attachment')
        .setDescription('File for Devin to work with')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('devin-template')
    .setDescription('Start a Devin session from a template'),
  new SlashCommandBuilder()
    .setName('devin-reply')
    .setDescription('Send a message to a Devin session')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Message to send to Devin')
        .setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('attachment')
        .setDescription('File to attach')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('session_id')
        .setDescription('Session ID (auto-detected if used in a session thread)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('devin-stop')
    .setDescription('Terminate a Devin session')
    .addStringOption(opt =>
      opt.setName('session_id')
        .setDescription('Session ID (auto-detected if used in a session thread)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('devin-sessions')
    .setDescription('List active Devin sessions'),
];

// --- Register commands on ready ---
client.once('ready', async () => {
  console.log(`✓ Logged in as ${client.user.tag}`);

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

  for (const guild of client.guilds.cache.values()) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log(`✓ Commands registered in "${guild.name}"`);
  }
});

// --- Handle slash commands and component interactions ---
const commandHandlers = {
  'devin': handleDevin,
  'devin-template': handleDevinTemplate,
  'devin-reply': handleDevinReply,
  'devin-stop': handleDevinStop,
  'devin-sessions': handleDevinSessions,
};

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = commandHandlers[interaction.commandName];
      if (handler) await handler(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId === 'template-select') {
      await handleTemplateSelect(interaction);
    } else if (interaction.isModalSubmit() && interaction.customId.startsWith('template-modal:')) {
      await handleTemplateSubmit(interaction);
    }
  } catch (err) {
    console.error('[Interaction] Error:', err);
    const reply = { content: `Something went wrong: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// --- Handle @mentions and thread messages ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    const sessionId = sessionManager.getSessionByThread(message.channelId);

    if (sessionId) {
      // Message is in a session thread — forward to Devin or handle keyword
      await handleThreadMessage(message, sessionId);
    } else if (message.mentions.has(client.user)) {
      // Bot was @mentioned in a channel — create a new session
      await handleMention(message);
    }
  } catch (err) {
    console.error('[Message] Error:', err);
    await message.react('⚠️').catch(() => {});
  }
});

// --- Helpers ---

async function processAttachment(interaction) {
  const attachment = interaction.options.getAttachment('attachment');
  if (!attachment) return '';

  let fileRes;
  try {
    fileRes = await fetch(attachment.url);
    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
  } catch (err) {
    console.error(`[Attachment] Failed to download ${attachment.name}: ${err.message}`);
    return `\n(Failed to download attachment: ${attachment.name})`;
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const fileUrl = await uploadAttachment(attachment.name, buffer);
  return `\nATTACHMENT:"${fileUrl}"`;
}

async function processMessageAttachments(message) {
  let lines = '';
  for (const attachment of message.attachments.values()) {
    let fileRes;
    try {
      fileRes = await fetch(attachment.url);
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
    } catch (err) {
      console.error(`[Attachment] Failed to download ${attachment.name}: ${err.message}`);
      lines += `\n(Failed to download attachment: ${attachment.name})`;
      continue;
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const fileUrl = await uploadAttachment(attachment.name, buffer);
    lines += `\nATTACHMENT:"${fileUrl}"`;
  }
  return lines;
}

function resolveSessionId(interaction) {
  const explicit = interaction.options.getString('session_id');
  if (explicit) return explicit;
  return sessionManager.getSessionByThread(interaction.channelId);
}

function stripMention(content) {
  return content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
}

// --- @mention in a channel → create session ---
async function handleMention(message) {
  const channel = message.channel;
  if (!channel?.threads) {
    await message.reply('Tag me in a text channel to start a session!');
    return;
  }

  const task = stripMention(message.content);
  if (!task && message.attachments.size === 0) {
    await message.reply('What would you like me to work on? Tag me with a task description.');
    return;
  }

  await message.react('👀');

  // Build prompt with any file attachments
  const attachmentLines = await processMessageAttachments(message);
  const prompt = (task || 'See attached files.') + attachmentLines;

  const { session_id, url } = await createSession(prompt);
  console.log(`[Devin] Session created via @mention: ${session_id} — ${url}`);

  const thread = await channel.threads.create({
    name: `Devin: ${task.slice(0, THREAD_NAME_MAX_LENGTH - 7) || 'New session'}`,
    autoArchiveDuration: THREAD_AUTO_ARCHIVE_DURATION,
    reason: `Devin session ${session_id}`,
  });

  const embed = new EmbedBuilder()
    .setTitle('🤖 Devin Session Started')
    .setDescription(task || '*File attachment session*')
    .setColor(EMBED_COLORS.working)
    .addFields(
      { name: 'Status', value: '🟡 Working', inline: true },
      { name: 'Session ID', value: `\`${session_id}\``, inline: true },
      { name: 'View Session', value: `[Open in Devin](${url})` },
    )
    .setTimestamp()
    .setFooter({ text: `Requested by ${message.author.tag}` });

  if (message.attachments.size > 0) {
    embed.addFields({
      name: 'Attachments',
      value: [...message.attachments.values()].map(a => a.name).join(', '),
      inline: true,
    });
  }

  await sessionManager.track(session_id, thread, url, message.author.id, {
    originalMessageId: message.id,
    originalChannelId: message.channelId,
  });

  await thread.send({ embeds: [embed] });
  await message.reply(`Session started! Follow progress in ${thread}`);
}

// --- Message in a session thread → forward to Devin or handle keyword ---
async function handleThreadMessage(message, sessionId) {
  const content = stripMention(message.content);
  const lower = content.toLowerCase();
  const tracked = sessionManager.getTracked(sessionId);

  // Keywords that require session ownership
  if (lower === 'exit') {
    if (tracked && message.author.id !== tracked.userId) {
      await message.react('🚫');
      return;
    }
    try {
      await terminateSession(sessionId);
    } catch (err) {
      console.error(`[Thread] Failed to terminate session: ${err.message}`);
    }
    await sessionManager.userStop(sessionId);
    await message.react('⏹️');
    return;
  }

  if (lower === 'mute') {
    if (tracked && message.author.id !== tracked.userId) {
      await message.react('🚫');
      return;
    }
    sessionManager.setMuted(sessionId, true);
    await message.react('🔇');
    return;
  }

  if (lower === 'unmute') {
    if (tracked && message.author.id !== tracked.userId) {
      await message.react('🚫');
      return;
    }
    sessionManager.setMuted(sessionId, false);
    await message.react('🔊');
    return;
  }

  // Aside — don't forward to Devin
  if (lower.startsWith('!aside') || lower.startsWith('(aside)')) return;

  // Don't forward if muted — react to indicate
  if (sessionManager.isMuted(sessionId)) {
    await message.react('🔇');
    return;
  }

  // Don't forward if session is in a terminal state
  if (tracked && TERMINAL_STATUSES.has(tracked.lastStatus)) {
    await message.react('⚠️');
    return;
  }

  // Nothing to send
  if (!content && message.attachments.size === 0) return;

  // Forward message + attachments to Devin
  const attachmentLines = await processMessageAttachments(message);
  const fullMessage = (content || '') + attachmentLines;

  await sendMessage(sessionId, fullMessage);
  await message.react('✉️');
}

// --- /devin ---
async function handleDevin(interaction) {
  const task = interaction.options.getString('task');

  const channel = interaction.channel;
  if (!channel?.threads) {
    await interaction.reply({
      content: 'This command must be used in a text channel, not inside a thread or DM.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const attachmentLine = await processAttachment(interaction);
  const prompt = task + attachmentLine;

  const { session_id, url } = await createSession(prompt);
  console.log(`[Devin] Session created: ${session_id} — ${url}`);

  const thread = await channel.threads.create({
    name: `Devin: ${task.slice(0, THREAD_NAME_MAX_LENGTH - 7)}`,
    autoArchiveDuration: THREAD_AUTO_ARCHIVE_DURATION,
    reason: `Devin session ${session_id}`,
  });

  const embed = new EmbedBuilder()
    .setTitle('🤖 Devin Session Started')
    .setDescription(task)
    .setColor(EMBED_COLORS.working)
    .addFields(
      { name: 'Status', value: '🟡 Working', inline: true },
      { name: 'Session ID', value: `\`${session_id}\``, inline: true },
      { name: 'View Session', value: `[Open in Devin](${url})` },
    )
    .setTimestamp()
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  const attachment = interaction.options.getAttachment('attachment');
  if (attachment) {
    embed.addFields({ name: 'Attachment', value: attachment.name, inline: true });
  }

  await sessionManager.track(session_id, thread, url, interaction.user.id);

  await thread.send({ embeds: [embed] });
  await interaction.editReply(`Session started! Follow progress in ${thread}`);
}

// --- /devin-template ---
async function handleDevinTemplate(interaction) {
  const channel = interaction.channel;
  if (!channel?.threads) {
    await interaction.reply({
      content: 'This command must be used in a text channel, not inside a thread or DM.',
      ephemeral: true,
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('template-select')
    .setPlaceholder('Choose a template...')
    .addOptions(
      TEMPLATES.map(t => ({
        label: t.name,
        description: t.description,
        value: t.id,
        emoji: t.emoji,
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**What would you like Devin to help with?**',
    components: [row],
    ephemeral: true,
  });
}

async function handleTemplateSelect(interaction) {
  const templateId = interaction.values[0];
  const template = getTemplate(templateId);
  if (!template) {
    await interaction.reply({ content: 'Unknown template.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`template-modal:${templateId}`)
    .setTitle(`Devin: ${template.name}`);

  for (const field of template.fields) {
    const input = new TextInputBuilder()
      .setCustomId(`field:${field.id}`)
      .setLabel(field.label)
      .setPlaceholder(field.placeholder || '')
      .setStyle(field.short ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(field.required);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  await interaction.showModal(modal);
}

async function handleTemplateSubmit(interaction) {
  const templateId = interaction.customId.replace('template-modal:', '');
  const template = getTemplate(templateId);
  if (!template) {
    await interaction.reply({ content: 'Unknown template.', ephemeral: true });
    return;
  }

  const channel = interaction.channel || await client.channels.fetch(interaction.channelId);
  if (!channel?.threads) {
    await interaction.reply({
      content: 'Could not create a thread here. Use /devin-template in a text channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const fields = {};
  for (const field of template.fields) {
    fields[field.id] = interaction.fields.getTextInputValue(`field:${field.id}`) || '';
  }

  const prompt = template.buildPrompt(fields);
  const mainDetail = fields.details || fields.url || fields.repo || '';
  const threadName = `Devin: ${template.emoji} ${template.name} — ${mainDetail}`;

  const { session_id, url } = await createSession(prompt);
  console.log(`[Devin] Template session created: ${session_id} — ${url}`);

  const thread = await channel.threads.create({
    name: threadName.slice(0, THREAD_NAME_MAX_LENGTH),
    autoArchiveDuration: THREAD_AUTO_ARCHIVE_DURATION,
    reason: `Devin session ${session_id}`,
  });

  const embed = new EmbedBuilder()
    .setTitle(`🤖 ${template.name}`)
    .setDescription(prompt)
    .setColor(EMBED_COLORS.working)
    .addFields(
      { name: 'Status', value: '🟡 Working', inline: true },
      { name: 'Session ID', value: `\`${session_id}\``, inline: true },
      { name: 'View Session', value: `[Open in Devin](${url})` },
    )
    .setTimestamp()
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  await sessionManager.track(session_id, thread, url, interaction.user.id);

  await thread.send({ embeds: [embed] });
  await interaction.editReply(`Session started! Follow progress in ${thread}`);
}

// --- /devin-reply ---
async function handleDevinReply(interaction) {
  const sessionId = resolveSessionId(interaction);
  if (!sessionId) {
    await interaction.reply({
      content: 'Could not detect session. Use this command in a session thread, or provide a `session_id`.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const message = interaction.options.getString('message');
  const attachmentLine = await processAttachment(interaction);
  const fullMessage = message + attachmentLine;

  await sendMessage(sessionId, fullMessage);

  const embed = new EmbedBuilder()
    .setTitle('💬 Message Sent to Devin')
    .setDescription(message)
    .setColor(EMBED_COLORS.devinMsg)
    .setTimestamp()
    .setFooter({ text: `Sent by ${interaction.user.tag}` });

  const attachment = interaction.options.getAttachment('attachment');
  if (attachment) {
    embed.addFields({ name: 'Attachment', value: attachment.name, inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

// --- /devin-stop ---
async function handleDevinStop(interaction) {
  const sessionId = resolveSessionId(interaction);
  if (!sessionId) {
    await interaction.reply({
      content: 'Could not detect session. Use this command in a session thread, or provide a `session_id`.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    await terminateSession(sessionId);
  } catch (err) {
    console.error(`[Stop] Failed to terminate session ${sessionId}: ${err.message}`);
  }
  await sessionManager.userStop(sessionId);

  const embed = new EmbedBuilder()
    .setTitle('⏹️ Session Terminated')
    .setDescription(`Session \`${sessionId}\` has been terminated.`)
    .setColor(EMBED_COLORS.stopped)
    .setTimestamp()
    .setFooter({ text: EMBED_FOOTER_TEXT });

  await interaction.editReply({ embeds: [embed] });
}

// --- /devin-sessions ---
async function handleDevinSessions(interaction) {
  const sessions = sessionManager.getActiveSessions();

  if (sessions.length === 0) {
    await interaction.reply({ content: 'No active Devin sessions.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Active Devin Sessions')
    .setColor(EMBED_COLORS.devinMsg)
    .setDescription(
      sessions.map(s => {
        const shortId = s.sessionId.length > 8
          ? s.sessionId.slice(0, 8) + '…'
          : s.sessionId;
        return `• \`${shortId}\` — ${s.status} — <#${s.threadId}>`;
      }).join('\n')
    )
    .setTimestamp()
    .setFooter({ text: EMBED_FOOTER_TEXT });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// --- Start ---
client.login(process.env.DISCORD_BOT_TOKEN);

// --- Graceful shutdown ---
function shutdown() {
  console.log('\nShutting down...');
  sessionManager.stopAll();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
