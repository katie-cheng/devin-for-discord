# devin-for-discord

A Discord bot that brings Devin's autonomous coding capabilities to Discord. Tag `@Devin` or use slash commands to start sessions — the bot creates a dedicated thread and posts real-time progress updates.

## Setup

### Prerequisites
- Node.js 18+
- A Discord bot ([create one here](https://discord.com/developers/applications))
  - Enable the **Message Content** privileged gateway intent in the bot settings
  - Invite with permissions: Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History, Add Reactions, Use Slash Commands
- A Devin API key (starts with `apk_`)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Fill in your `.env`:
- `DISCORD_BOT_TOKEN` — Bot token from the Discord developer portal
- `DISCORD_CLIENT_ID` — Application ID from the Discord developer portal
- `DEVIN_API_KEY` — Your Devin API key

### 3. Run
```bash
npm start
```

## Usage

### @Mention

Tag `@Devin` in any text channel to start a session:

> **@Devin** Write a Python script that fetches the top stories from Hacker News

The bot reacts with 👀, creates a Devin session, and opens a thread for the conversation. You can include file attachments with your message.

### Slash commands

| Command | Description |
|---------|-------------|
| `/devin task:<description>` | Start a new Devin session with a freeform task |
| `/devin-template` | Start a session from a template (see [Templates](#templates)) |
| `/devin-reply message:<text>` | Send a message to Devin (use in a session thread) |
| `/devin-stop` | Terminate a session (use in a session thread) |
| `/devin-sessions` | List all active sessions being tracked |

`/devin`, `/devin-reply`, and `/devin-stop` support an optional `session_id` parameter (auto-detected when used inside a session thread). `/devin` and `/devin-reply` also accept optional file attachments.

### Thread conversation

Messages sent in a session thread are automatically forwarded to Devin — no slash command needed. The bot reacts with ✉️ to confirm delivery.

#### Thread keywords

| Keyword | Function |
|---------|----------|
| `mute` | Stops forwarding messages to Devin (owner only) |
| `unmute` | Resumes forwarding messages (owner only) |
| `!aside` or `(aside)` | Message is ignored by Devin (useful for side conversations) |
| `EXIT` | Terminates the session (owner only) |

### Templates

Use `/devin-template` to start a session from a pre-built template. Select a template from the dropdown, fill in the form, and Devin gets to work.

| Template | Description |
|----------|-------------|
| **Open a PR** | Write code and open a pull request. Specify a repo and what the PR should do. |
| **Code Review** | Review an existing pull request. Provide the PR URL and optional focus areas. |
| **Write Tests** | Add test coverage to a repo. Specify what to test. |
| **Fix a Bug** | Investigate and fix a bug. Describe the issue and Devin will open a PR with the fix. |

## How it works

1. User tags `@Devin` with a task, runs `/devin`, or picks a template via `/devin-template`
2. Bot creates a Devin session via the API and opens a Discord thread
3. Bot polls the Devin API with adaptive intervals (every 5s for the first 2 minutes, then every 15s)
4. A "Devin is thinking..." indicator with an elapsed timer is shown while Devin works
5. New messages from Devin are posted as embeds in the thread
6. When Devin creates a pull request, a PR embed with a direct link is posted
7. When the session finishes or expires, a final status embed is posted and polling stops

### Status indicators

Session threads use color-coded embeds:

| Status | Color | Meaning |
|--------|-------|---------|
| Working | 🟡 Yellow | Devin is actively working |
| Blocked | 🟠 Orange | Devin needs input |
| Finished | 🟢 Green | Task complete |
| Expired | 🔴 Red | Session expired |

For sessions started via `@Devin`, the bot also adds reactions to the original message:

| Reaction | Meaning |
|----------|---------|
| 👀 | Session created |
| ✉️ | Thread message forwarded to Devin |
| ✅ | Session finished |
| ❌ | Session expired or failed |

## Architecture

```
src/
├── index.js            # Bot entry point, slash commands, @mention and thread message handlers
├── devin.js            # Devin API client (sessions, messages, attachments)
├── sessionManager.js   # Session tracking, adaptive polling, status embeds
└── templates.js        # Curated prompt templates for common tasks
```

Single-process, in-memory state. No database — designed as a clean demo, not a production system.

See [DOCS.md](DOCS.md) for extended documentation.
