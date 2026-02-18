# MCBridge — Setup & Tutorial

> Control your Minecraft bot from Discord. No mods. No plugins. Just power.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org)
[![Mineflayer](https://img.shields.io/badge/Mineflayer-v4-00aa00?style=for-the-badge)](https://github.com/PrismarineJS/mineflayer)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Termux](https://img.shields.io/badge/Termux-Ready-black?style=for-the-badge&logo=android&logoColor=white)](https://termux.dev)

---

## 📋 Table of Contents

- [Requirements](#requirements)
- [Step 1 — Create your Discord Bot](#step-1--create-your-discord-bot)
- [Step 2 — Install Node.js](#step-2--install-nodejs)
- [Step 3 — Download & Configure](#step-3--download--configure)
- [Step 4 — Run the Bot](#step-4--run-the-bot)
- [Android / Termux](#android--termux)
- [Windows](#windows)
- [Linux / VPS](#linux--vps)
- [Command Reference](#command-reference)
- [Configuration Options](#configuration-options)
- [How Auth Works](#how-auth-works)
- [How Auto-Reconnect Works](#how-auto-reconnect-works)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- **Node.js** v18 or higher — [nodejs.org](https://nodejs.org)
- **A Discord Bot Token** — free at [discord.com/developers](https://discord.com/developers/applications)
- **A Minecraft Server** to connect to (cracked or premium)
- **npm** — comes bundled with Node.js

---

## Step 1 — Create your Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name → **Create**
3. Go to the **Bot** tab on the left sidebar
4. Click **Reset Token** → copy the token and save it somewhere safe
5. Scroll down and enable **MESSAGE CONTENT INTENT** ✅ — without this the bot cannot read your commands
6. Go to **OAuth2 → URL Generator**:
   - Under **Scopes** → check `bot`
   - Under **Bot Permissions** → check `Send Messages`, `Read Message History`, `Embed Links`, `View Channels`
7. Copy the generated URL at the bottom, open it in your browser, and invite the bot to your Discord server
8. In Discord go to **Settings → Advanced → Developer Mode → ON**
9. Right-click the channel you want the bot to operate in → **Copy Channel ID**

You now have your **Bot Token** and **Channel ID** — you'll need both in Step 3.

---

## Step 2 — Install Node.js

<details>
<summary><b>Windows</b></summary>

Download and install the **LTS** version from [nodejs.org](https://nodejs.org).  
After installing, open **Command Prompt** or **PowerShell** and verify:

```cmd
node --version
npm --version
```

Both should print a version number.

</details>

<details>
<summary><b>Linux / Ubuntu / Debian</b></summary>

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x.x or higher
```

</details>

<details>
<summary><b>Android (Termux)</b></summary>

```bash
pkg update && pkg upgrade -y
pkg install nodejs -y
node --version
```

</details>

---

## Step 3 — Download & Configure

**Clone this repo:**
```bash
git clone https://github.com/yourusername/mcbridge.git
cd mcbridge
```

Or download `index.js` and `package.json` manually and put them in a folder.

**Open `index.js`** in any text editor and find the `CONFIG` block near the top. Fill in your details:

```js
const CONFIG = {
  discord: {
    token:     'YOUR_DISCORD_BOT_TOKEN_HERE',  // ← your bot token from Step 1
    channelId: 'YOUR_CHANNEL_ID_HERE',         // ← your channel ID from Step 1
    prefix:    '!',                            // ← command prefix, change if you want
  },
  mc: {
    host:         'play.yourserver.net',  // ← your Minecraft server IP
    port:         25565,                  // ← server port (default is 25565)
    username:     'CoolBot',             // ← the username the bot will use
    version:      '1.20.1',             // ← MUST match your server's Minecraft version exactly
    auth:         'offline',            // ← 'offline' for cracked, 'microsoft' for premium
    authPassword: 'BotPassword123',     // ← auth plugin password — leave '' if server has none
  },
};
```

> ⚠️ **Critical:** The `version` field must exactly match your server's version.  
> If the server runs `1.20.4`, write `'1.20.4'`. Wrong version = connection refused.  
> To find it: open Minecraft, go to Multiplayer — it shows the server's version in the list.

> ⚠️ **Never share your `index.js`** if it contains your real Discord token.

---

## Step 4 — Run the Bot

```bash
npm install
node index.js
```

Expected output in your terminal:
```
╔══════════════════════════════════════╗
  Minecraft Discord Bot  v3.0
  Server  : play.yourserver.net:25565
  Username: CoolBot
  Auth    : offline | Password: set ✓
╚══════════════════════════════════════╝

[12:00:00] Discord ready as MCBridge#1234
[12:00:01] Connecting to play.yourserver.net:25565 (attempt #1)…
```

And in your Discord channel you'll see a green **✅ Connected** embed with the server details.

**You're done.** Type `!help` in the Discord channel to see all commands.

---

## Android / Termux

Full setup from scratch on Android:

```bash
# Install required packages
pkg update && pkg upgrade -y
pkg install nodejs git -y

# Clone the repo
git clone https://github.com/yourusername/mcbridge.git
cd mcbridge

# Edit the config
nano index.js
# Make your changes, then press: Ctrl+X → Y → Enter to save

# Install dependencies
npm install

# Run
node index.js
```

### Keep it running after closing Termux

Without tmux, the bot stops when Termux is closed or the screen turns off. Fix this:

```bash
# Install tmux
pkg install tmux -y

# Start a named session
tmux new -s mcbot

# Run the bot inside the session
node index.js

# Detach from the session (bot keeps running):
# Press Ctrl+B, then press D

# Later, reattach to see the bot's output:
tmux attach -t mcbot

# Kill the session (stops the bot):
tmux kill-session -t mcbot
```

---

## Windows

```cmd
cd C:\path\to\mcbridge
npm install
node index.js
```

**To keep it running in the background (optional):**

```cmd
npm install -g pm2
pm2 start index.js --name mcbot
pm2 save
```

To stop it: `pm2 stop mcbot`  
To restart it: `pm2 restart mcbot`  
To see logs: `pm2 logs mcbot`

---

## Linux / VPS

```bash
cd ~/mcbridge
npm install
node index.js
```

**To keep it running permanently with PM2:**

```bash
npm install -g pm2
pm2 start index.js --name mcbot
pm2 save
pm2 startup
# Copy and run the command it prints — this makes it survive reboots
```

**To keep it running in this terminal session only:**

```bash
# Using screen
screen -S mcbot
node index.js
# Detach: Ctrl+A then D
# Reattach: screen -r mcbot

# Or using nohup
nohup node index.js &> bot.log &
```

---

## Command Reference

All commands are sent in the Discord channel you set in `channelId`. Default prefix is `!`.

Commands marked with 🟢 work even when the bot is **offline**.

### 🔐 Auth

| Command | Description |
|---|---|
| `!authstatus` 🟢 | Auth state, last register time, re-register countdown |
| `!forcelogin` 🟢 | Force `/login` immediately |
| `!forceregister` 🟢 | Force `/register` immediately (password typed twice) |

### 📍 Movement

| Command | Description |
|---|---|
| `!goto <x> <y> <z>` | Pathfind to coordinates |
| `!follow <player>` | Continuously follow a player |
| `!stopfollow` | Stop following |
| `!come` | Come to the nearest visible player |
| `!tp <player>` | Teleport to a player via `/tp` |
| `!look <x> <y> <z>` | Look at coordinates |
| `!pos` | Show current X/Y/Z position |
| `!stop` | Stop all movement immediately |

### 🎒 Inventory

| Command | Description |
|---|---|
| `!invsee` | View everything in bot's inventory |
| `!give <player> <item> [amount]` | Give items via `/give` |
| `!drop <item>` | Drop matching items from bot's inventory |
| `!clear` | Clear bot inventory via `/clear` |

### 🏗️ Building

| Command | Description |
|---|---|
| `!setblock <x> <y> <z> <block>` | Place a block at coordinates |
| `!fill <x1> <y1> <z1> <x2> <y2> <z2> <block>` | Fill a region with a block |

### ⚡ Creative Powers

| Command | Description |
|---|---|
| `!fly` | Enable creative flight |
| `!gm <mode>` | Change gamemode — `creative`, `survival`, `adventure`, `spectator` |
| `!time <value>` | Set time — `day`, `night`, `noon`, `midnight`, or `0`–`24000` |
| `!weather <type>` | Set weather — `clear`, `rain`, `thunder` |
| `!summon <entity> [x y z]` | Summon entity (defaults to bot's position if no coords) |
| `!kill [target]` | Kill target — defaults to `@e[type=!player]` (all mobs) |

### 💬 Chat

| Command | Description |
|---|---|
| `!say <message>` | Send a message in Minecraft chat as the bot |
| `!cmd <command>` | Run any `/command` — e.g. `!cmd ban Steve` runs `/ban Steve` |

### 🤖 Bot Control

| Command | Description |
|---|---|
| `!status` 🟢 | Full info — server, position, HP, uptime, auth, players |
| `!players` | List all online players |
| `!reconnect` 🟢 | Force reconnect immediately |
| `!respawn` | Manually respawn the bot |
| `!autorespawn <on\|off>` | Toggle auto-respawn on death |
| `!attack <name>` | Attack a player or nearby entity |
| `!help` 🟢 | Show command list in Discord |

---

## Configuration Options

Full reference for every option in the `CONFIG` block:

```js
const CONFIG = {

  discord: {
    token:     'string',  // Your Discord bot token (required)
    channelId: 'string',  // The Discord channel ID to operate in (required)
    prefix:    '!',       // Command prefix — any single character or short string
  },

  mc: {
    host:         'string',  // Minecraft server IP or domain (required)
    port:         25565,     // Server port — default is 25565
    username:     'string',  // Username the bot logs in with
    version:      'string',  // Exact server version e.g. '1.20.1', '1.19.4', '1.8.9'
    auth:         'offline', // 'offline' = no account needed | 'microsoft' = premium account
    authPassword: 'string',  // Password for auth plugins like AuthMe. Leave '' to disable auth
  },

  reconnect: {
    initialDelay: 5000,   // First reconnect delay in milliseconds (5 seconds)
    maxDelay:     60000,  // Maximum reconnect delay in milliseconds (60 seconds)
    factor:       2,      // Multiply delay by this on each failed attempt (exponential backoff)
  },

  watchdog: {
    enabled:   true,   // Set to false to disable the watchdog entirely
    timeoutMs: 30000,  // Force reconnect if no server packet for this many milliseconds
  },

  chat: {
    mirrorToDiscord: true,  // Set to false to stop mirroring MC chat to Discord
    rateLimit:       3,     // Max chat messages mirrored to Discord per 3 seconds
  },

};
```

---

## How Auth Works

Many Minecraft servers run auth plugins like **AuthMe** or **nLogin** that require players to register and log in with a password before they can play.

MCBridge handles this fully automatically:

```
Bot spawns on server
        │
        ▼
Server sends auth prompt (or 5s fallback timer fires)
        │
        ├── Never registered (or 24h passed) ──► /register <pass> <pass>
        │                                         (password typed TWICE)
        │
        └── Already registered ────────────────► /login <pass>
                                                  (password typed ONCE)
                                                        │
                                                        ▼
                                             "Logged in successfully"
                                                        │
                                                        ▼
                                              /gamemode creative sent
```

**Key behaviors:**
- The bot watches for auth prompts in **both** system messages and player chat — covers all auth plugin types
- If the server sends no prompt at all, a **5-second fallback timer** triggers auth automatically
- Every **24 hours**, the bot re-registers automatically (configurable)
- After **death + respawn**, the bot re-authenticates without any input from you
- `!forcelogin` and `!forceregister` let you trigger auth manually from Discord anytime
- The password is **never logged or shown** in Discord — only `***` appears in messages

---

## How Auto-Reconnect Works

MCBridge uses **exponential backoff** so it doesn't hammer a downed server with rapid reconnects:

```
Disconnect detected
        │
        ▼
Attempt #1 — wait  5 seconds
        │ (fail)
        ▼
Attempt #2 — wait 10 seconds
        │ (fail)
        ▼
Attempt #3 — wait 20 seconds
        │ (fail)
        ▼
Attempt #4 — wait 40 seconds
        │ (fail)
        ▼
Attempt #5+ — wait 60 seconds (stays at max)
        │
        ▼
✅ Connected — delay resets back to 5 seconds
```

The **watchdog timer** runs in parallel. It resets on every packet received from the server. If 30 seconds pass with no packet — even if TCP hasn't dropped — the watchdog forces a reconnect. This catches frozen connections that would otherwise hang forever.

---

## FAQ

**The bot connects but instantly disconnects — why?**  
The `version` is wrong. It must exactly match your server's Minecraft version. Check the multiplayer server list in your Minecraft client for the correct version string.

**The bot never tries to login/register — why?**  
Either `authPassword` is empty in the config, or your server's auth message doesn't match any trigger phrase. Use `!forcelogin` or `!forceregister` to trigger it manually. You can also check `!authstatus` to see the current state.

**Can I run this on my Android phone 24/7?**  
Yes — use Termux + tmux. See the [Android / Termux](#android--termux) section above. Keep Termux in the battery optimization whitelist so Android doesn't kill it.

**Can I use this on a premium (online mode) server?**  
Yes. Set `auth: 'microsoft'` in the config. The bot will authenticate with Microsoft. You'll need a valid Minecraft account associated with your Microsoft account.

**The bot is in my server but not responding to commands — why?**  
Check that MESSAGE CONTENT INTENT is enabled in the Discord Developer Portal. Without it, Discord.js cannot read message content.

**Can I run two bots on the same server at once?**  
Yes — make two copies of the folder with different usernames and different Discord channel IDs, and run each with `node index.js` in separate terminals or tmux sessions.

**Where is the password stored? Is it safe?**  
The password is only in the `CONFIG` block inside `index.js` on your device. It's never sent to Discord or logged anywhere. Don't share your `index.js` file if it contains a real password.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG ERRORS` on startup | Placeholder values still in config | Edit the CONFIG block with real values |
| Bot connects then immediately leaves | Wrong `version` in config | Match the exact server version |
| Commands don't work in Discord | MESSAGE CONTENT INTENT disabled | Enable it in Discord Developer Portal |
| Auth never triggers automatically | `authPassword` is empty or server message not recognized | Use `!forcelogin` or `!forceregister` |
| `ECONNREFUSED` error | Server is offline or wrong IP/port | Check server is online and IP is correct |
| Bot reconnects in a loop every few seconds | Server is banning/kicking the bot | Check server logs — may be whitelist, ban, or version mismatch |
| Pathfinding doesn't work | Movement settings issue | Make sure bot is in creative mode (`!gm creative`) |
| Discord channel shows nothing | Wrong `channelId` in config | Copy the ID again with Developer Mode on |
| Bot hangs and never reconnects | Frozen connection (watchdog disabled?) | Ensure `watchdog.enabled` is `true` in config |

---

<div align="center">

Built with [Mineflayer](https://github.com/PrismarineJS/mineflayer) + [Discord.js](https://discord.js.org) · MIT License

*If this helped you, leave a ⭐ — it helps others find it!*

</div>

<!-- SEO: minecraft discord bot nodejs mineflayer auto login authme bot termux minecraft automation -->
