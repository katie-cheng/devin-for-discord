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
| `/devin task:<description>` | Start a new Devin session with the given task |
| `/devin-sessions` | List all active sessions being tracked |

## How it works

1. User runs `/devin Write a Python script that fetches HN top stories`
2. Bot creates a Devin session via the API
3. Bot creates a Discord thread for the session
4. Bot polls the Devin API every 30 seconds for updates
5. Status changes, new messages from Devin, and PR creation are posted to the thread
6. When the session finishes or expires, polling stops and a final summary is posted

## Architecture

```
src/
├── index.js            # Bot entry point, command handlers
├── devin.js            # Devin API client
└── sessionManager.js   # Session tracking and polling
```

Single-process, in-memory state. No database — designed as a clean demo, not a production system.
