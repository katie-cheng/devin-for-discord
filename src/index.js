import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';
import { createSession, sendMessage, terminateSession, uploadAttachment } from './devin.js';
import { SessionManager } from './sessionManager.js';

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
  intents: [GatewayIntentBits.Guilds],
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

  // Register guild commands (instant updates — ideal for development)
  for (const guild of client.guilds.cache.values()) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log(`✓ Commands registered in "${guild.name}"`);
  }
});

// --- Handle interactions ---
const handlers = {
  'devin': handleDevin,
  'devin-reply': handleDevinReply,
  'devin-stop': handleDevinStop,
  'devin-sessions': handleDevinSessions,
};

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`[Command] Error handling /${interaction.commandName}:`, err);
    const reply = { content: `Something went wrong: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// --- Helpers ---

/**
 * If the user attached a file, upload it to Devin and return the ATTACHMENT line.
 * Returns empty string if no attachment.
 */
async function processAttachment(interaction) {
  const attachment = interaction.options.getAttachment('attachment');
  if (!attachment) return '';

  const fileRes = await fetch(attachment.url);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const fileUrl = await uploadAttachment(attachment.name, buffer);
  return `\nATTACHMENT:"${fileUrl}"`;
}

/**
 * Resolve session ID from explicit option or auto-detect from thread.
 * Returns session ID or null (with error reply sent).
 */
function resolveSessionId(interaction) {
  const explicit = interaction.options.getString('session_id');
  if (explicit) return explicit;

  const fromThread = sessionManager.getSessionByThread(interaction.channelId);
  if (fromThread) return fromThread;

  return null;
}

// --- /devin ---
async function handleDevin(interaction) {
  const task = interaction.options.getString('task');

  // Must be used in a regular text channel (not a thread or DM)
  const channel = interaction.channel;
  if (!channel?.threads) {
    await interaction.reply({
      content: 'This command must be used in a text channel, not inside a thread or DM.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  // Handle optional attachment
  const attachmentLine = await processAttachment(interaction);
  const prompt = task + attachmentLine;

  // Create the Devin session
  const { session_id, url } = await createSession(prompt);
  console.log(`[Devin] Session created: ${session_id} — ${url}`);

  // Create a thread for this session
  const thread = await channel.threads.create({
    name: `Devin: ${task.slice(0, 90)}`,
    autoArchiveDuration: 1440,
    reason: `Devin session ${session_id}`,
  });

  // Post initial embed in the thread
  const embed = new EmbedBuilder()
    .setTitle('🤖 Devin Session Started')
    .setDescription(task)
    .setColor(0xFFAA00)
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

  await thread.send({ embeds: [embed] });
  await interaction.editReply(`Session started! Follow progress in ${thread}`);

  // Start polling for updates
  sessionManager.track(session_id, thread.id, url, interaction.user.id);
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

  // Confirm in the thread
  const embed = new EmbedBuilder()
    .setTitle('💬 Message Sent to Devin')
    .setDescription(message)
    .setColor(0x5865F2)
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

  await terminateSession(sessionId);
  sessionManager.stopTracking(sessionId);

  const embed = new EmbedBuilder()
    .setTitle('⏹️ Session Terminated')
    .setDescription(`Session \`${sessionId}\` has been terminated.`)
    .setColor(0xCC0000)
    .setTimestamp()
    .setFooter({ text: 'Devin for Discord' });

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
    .setColor(0x5865F2)
    .setDescription(
      sessions.map(s =>
        `• \`${s.sessionId.slice(0, 8)}…\` — ${s.status} — <#${s.threadId}>`
      ).join('\n')
    )
    .setTimestamp()
    .setFooter({ text: 'Devin for Discord' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// --- Start ---
client.login(process.env.DISCORD_BOT_TOKEN);

// --- Graceful shutdown ---
function shutdown() {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
