# Devin for Discord

Chat and collaborate with Devin directly in your Discord server.

Tag `@Devin` in Discord as soon as bugs, feature requests, and questions come in. Devin responds in-thread with updates and questions, and you can reply naturally — just like chatting with a teammate.

---

## Getting started

### Installation

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Create a bot user and copy the token
3. Enable the **Message Content** privileged gateway intent
4. Invite the bot to your server with the following permissions: Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History, Add Reactions, Use Slash Commands
5. Clone this repo, add your credentials to `.env`, and run `npm start`

See the [README](README.md) for detailed setup instructions.

---

## How to use Devin from Discord

Once the bot is running in your server, simply tag `@Devin` in any text channel to start a session. You may include attachments with your message.

> **@Devin** Write a Python script that fetches the top stories from Hacker News and saves them to a CSV file

Devin will respond in a dedicated thread. You can communicate back and forth as you would in the regular chat interface — just type in the thread and your messages are automatically forwarded to Devin.

When Devin is blocked and needs input, it will ping you in the thread with a link to the session. Reply directly in the thread to unblock it.

Note that Devin may make mistakes. Please double-check responses.

---

## Slash commands

You can also interact with Devin using slash commands:

| Command | Description |
|---------|-------------|
| `/devin task:<description>` | Start a new Devin session with a freeform task |
| `/devin-template` | Start a session from a curated template (see below) |
| `/devin-reply message:<text>` | Send a message to Devin in a session thread |
| `/devin-stop` | Terminate a Devin session |
| `/devin-sessions` | List all active Devin sessions |

`/devin` and `/devin-reply` support optional file attachments.

---

## Templates

Use `/devin-template` to start a session from a pre-built template. Select a template from the dropdown, fill in the form, and Devin gets to work.

| Template | Description |
|----------|-------------|
| **Open a PR** | Write code and open a pull request. Specify a repo and what the PR should do. |
| **Code Review** | Review an existing pull request. Provide the PR URL and optional focus areas. |
| **Write Tests** | Add test coverage to a repo. Specify what to test. |
| **Fix a Bug** | Investigate and fix a bug. Describe the issue and Devin will open a PR with the fix. |

---

## Thread keywords

When chatting with Devin in a session thread, you can use these keywords:

| Keyword | Function |
|---------|----------|
| `mute` | Prevents Devin from seeing further messages in the thread |
| `unmute` | Reverses the above |
| `!aside`, `(aside)` | Causes Devin to ignore the message (useful for side conversations in-thread) |
| `EXIT` | Ends the session |

---

## Status indicators

### Thread embeds

Devin posts status updates as color-coded embeds in the session thread:

| Status | Color | Meaning |
|--------|-------|---------|
| Working | Yellow | Devin is actively working on the task |
| Blocked | Orange | Devin needs input — reply in the thread or open the session in Devin |
| Finished | Green | Task is complete |
| Expired | Red | Session has expired |

When Devin creates a pull request, a green PR embed with a direct link is posted to the thread.

### Message reactions

When you start a session by tagging `@Devin`, the bot uses reactions to show progress on your original message:

| Reaction | Meaning |
|----------|---------|
| 👀 | Session acknowledged — Devin is starting |
| ✉️ | Your thread message was forwarded to Devin |
| ✅ | Session finished successfully |
| ❌ | Session expired or failed |

---

## Dedicated Devin channel

Set up a `#devin` channel (or similar) to keep all Devin conversations in one place. This helps your team:

- Collaborate on Devin sessions together
- See what tasks are being worked on
- Draw inspiration for different use cases from each other

Each session gets its own thread, so conversations stay organized even with many concurrent sessions.

---

## Tips

- **Be specific.** The more detail you give Devin, the better the results. Include repo names, file paths, and expected behavior.
- **Use templates for common tasks.** `/devin-template` gives you structured forms for PRs, code reviews, tests, and bug fixes.
- **Attach files.** You can attach files to `@Devin` messages, `/devin`, and `/devin-reply` — they'll be uploaded and included in the session.
- **Check the Devin UI for full context.** Every session embed includes a "View in Devin" link. The Discord thread shows key updates, but the full Devin interface has the complete picture.

---

## Privacy

All sessions are created using the Devin API key configured in the bot's environment. Sessions run under the account associated with that API key, using that organization's repos, secrets, and ACU credits.

Message content is only read in channels where the bot is present, and only to detect `@Devin` mentions and forward thread messages to active sessions.
