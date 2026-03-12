# devin-for-discord

A Discord bot that brings Devin's autonomous coding capabilities to Discord. Users invoke `/devin [task]`, the bot creates a Devin session, spins up a dedicated thread, and posts real-time progress updates.

## Setup

### Prerequisites
- Node.js 18+
- A Discord bot ([create one here](https://discord.com/developers/applications))
- A Devin API key (legacy V1)

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
- `DEVIN_API_KEY` — Your Devin API key (starts with `apk_`)

### 3. Run
```bash
npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `/devin task:<description>` | Start a new Devin session with a freeform task |
| `/devin-template` | Start a session from a template (Open PR, Code Review, Write Tests, Fix Bug) |
| `/devin-reply message:<text>` | Send a message to Devin (use in a session thread) |
| `/devin-stop` | Terminate a session (use in a session thread) |
| `/devin-sessions` | List all active sessions being tracked |

All commands support optional file attachments where applicable.

## How it works

1. User runs `/devin` with a task or picks a template via `/devin-template`
2. Bot creates a Devin session via the API
3. Bot creates a Discord thread for the session
4. Bot polls the Devin API every 30 seconds for updates
5. Status changes, new messages from Devin, and PR creation are posted to the thread
6. If Devin is blocked, it pings the user — they can reply with `/devin-reply`
7. When the session finishes or expires, polling stops and a final summary is posted

## Architecture

```
src/
├── index.js            # Bot entry point, command handlers
├── devin.js            # Devin API client
├── sessionManager.js   # Session tracking and polling
└── templates.js        # Curated prompt templates
```

Single-process, in-memory state. No database — designed as a clean demo, not a production system.
