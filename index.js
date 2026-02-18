// ╔═══════════════════════════════════════════════════════════╗
//   MINECRAFT DISCORD BOT  ·  v3.0  ·  Single File
//   Auto Auth · Creative Mode · Exponential Backoff Reconnect
//   Ping Watchdog · Rate Limiting · Uptime Tracking
// ╚═══════════════════════════════════════════════════════════╝
//
//  ★  SETUP — Edit the CONFIG block below, then:
//       npm install
//       node index.js
//

'use strict';

// ═══════════════════════════════════════════════════════════
//  CONFIG  ←  Only edit this section
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  discord: {
    token:     'YOUR_DISCORD_BOT_TOKEN_HERE',  // discord.com/developers → Bot → Token
    channelId: 'YOUR_CHANNEL_ID_HERE',         // Right-click channel → Copy Channel ID
    prefix:    '!',                            // Command prefix (e.g. ! means !help)
  },
  mc: {
    host:         'here',   // Server IP or domain
    port:         00000,              // Server port (default 25565)
    username:     'coolbot',         // Bot's Minecraft username
    version:      '1.21.7',          // Must match your server version exactly
    auth:         'offline',         // 'offline' = cracked  |  'microsoft' = premium account
    authPassword: 'here',  // Auth plugin password — leave '' if server has no auth
  },
  reconnect: {
    initialDelay: 5_000,   // First reconnect wait (ms)
    maxDelay:     60_000,  // Maximum reconnect wait (ms)
    factor:       2,       // Backoff multiplier per failed attempt
  },
  watchdog: {
    enabled:      false,
    timeoutMs:    30_000,  // Kick bot if no server packet for this long
  },
  chat: {
    mirrorToDiscord: true,  // Mirror MC chat → Discord
    rateLimit:       3,     // Max Discord messages per 3 seconds from MC chat
  },
};
// ═══════════════════════════════════════════════════════════

const mineflayer  = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock, GoalFollow }        = goals;
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');

// ─── Global safety net ────────────────────────────────────
process.on('uncaughtException',  (e) => console.error('[CRASH GUARD] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[CRASH GUARD] unhandledRejection:', e));

// ─── Startup config validation ────────────────────────────
function validateConfig() {
  const errors = [];
  if (!CONFIG.discord.token || CONFIG.discord.token.includes('YOUR_DISCORD'))
    errors.push('discord.token is not set — open index.js and fill in your Discord bot token');
  if (!CONFIG.discord.channelId || CONFIG.discord.channelId.includes('YOUR_CHANNEL'))
    errors.push('discord.channelId is not set — open index.js and fill in your Discord channel ID');
  if (!CONFIG.mc.host || CONFIG.mc.host === 'your.server.ip')
    errors.push('mc.host is not set — open index.js and fill in your Minecraft server IP');
  if (errors.length) {
    console.error('\n╔══════════ CONFIG ERRORS ══════════╗');
    errors.forEach(e => console.error('  ✗', e));
    console.error('╚═══════════════════════════════════╝\n');
    process.exit(1);
  }
}
validateConfig();

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let bot             = null;
let mcChannel       = null;
let followTarget    = null;
let followInterval  = null;
let reregInterval   = null;
let reconnectTimer  = null;
let watchdogTimer   = null;
let autoRespawn     = true;

// Auth
let isAuthenticated = false;
let authPending     = false;
let lastRegisterAt  = 0;
const REREG_MS      = 24 * 60 * 60 * 1000;

// Reconnect backoff
let reconnectDelay    = CONFIG.reconnect.initialDelay;
let reconnectAttempts = 0;

// Uptime
let connectedAt = null;

// Chat rate limiter
let chatBurst = 0;
let chatBurstTimer = null;

// Health warn cooldown (30 s)
let lastHealthWarn = 0;

// ═══════════════════════════════════════════════════════════
//  DISCORD CLIENT
// ═══════════════════════════════════════════════════════════
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Commands usable even while bot is offline
const OFFLINE_OK = new Set([
  'help', 'status', 'authstatus', 'reconnect',
  'forcelogin', 'forceregister',
]);

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
function ts() {
  return new Date().toLocaleTimeString('en', { hour12: false });
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function mkEmbed(title, desc, color = 0x00ff88) {
  return new EmbedBuilder()
    .setTitle(String(title).slice(0, 256))
    .setDescription(String(desc || '\u200B').slice(0, 4096))
    .setColor(color)
    .setTimestamp();
}

async function dlog(title, desc, color) {
  if (!mcChannel) return;
  try { await mcChannel.send({ embeds: [mkEmbed(title, desc, color)] }); }
  catch (_) { /* channel gone / no perms — swallow silently */ }
}

// Safe MC chat — always null-checks before sending
function botChat(text) {
  try {
    if (bot?.entity) bot.chat(String(text));
  } catch (_) {}
}

// Rate-limited Discord send for MC chat mirror
async function mirrorChat(username, message) {
  if (!CONFIG.chat.mirrorToDiscord || !mcChannel) return;

  chatBurst++;
  if (chatBurst > CONFIG.chat.rateLimit) return; // drop excess
  if (!chatBurstTimer) {
    chatBurstTimer = setTimeout(() => { chatBurst = 0; chatBurstTimer = null; }, 3000);
  }

  try {
    await mcChannel.send({ embeds: [mkEmbed(`💬 ${username}`, message, 0x5865f2)] });
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  WATCHDOG  — restarts bot if server goes silent
// ═══════════════════════════════════════════════════════════
function resetWatchdog() {
  if (!CONFIG.watchdog.enabled) return;
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    console.warn(`[${ts()}] Watchdog fired — no server packet for ${CONFIG.watchdog.timeoutMs / 1000}s, forcing reconnect`);
    dlog('🐕 Watchdog', `No server response for **${CONFIG.watchdog.timeoutMs / 1000}s** — forcing reconnect…`, 0xff8800);
    destroyBot();
    scheduleReconnect();
  }, CONFIG.watchdog.timeoutMs);
}

function stopWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

// ═══════════════════════════════════════════════════════════
//  RECONNECT with exponential backoff
// ═══════════════════════════════════════════════════════════
function scheduleReconnect() {
  if (reconnectTimer) return; // already scheduled

  reconnectAttempts++;
  const delay = Math.min(reconnectDelay, CONFIG.reconnect.maxDelay);

  console.log(`[${ts()}] Reconnect #${reconnectAttempts} in ${delay / 1000}s…`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);

  // Increase delay for next attempt
  reconnectDelay = Math.min(reconnectDelay * CONFIG.reconnect.factor, CONFIG.reconnect.maxDelay);
}

function resetBackoff() {
  reconnectDelay    = CONFIG.reconnect.initialDelay;
  reconnectAttempts = 0;
}

// ═══════════════════════════════════════════════════════════
//  AUTH SYSTEM
// ═══════════════════════════════════════════════════════════
const REGISTER_KW = [
  'register', '/register', 'not registered', 'you must register',
  'please register', 'use /register', 'регистр', 'зарегистрируй',
];
const LOGIN_KW = [
  'login', 'log in', '/login', 'not logged', 'please login',
  'you must login', 'use /login', 'войдите', 'авторизуй',
];
// Specific phrases — avoids false positives like "/give succeeded"
const SUCCESS_KW = [
  'logged in successfully', 'successfully logged', 'welcome back',
  'you are now logged', 'login successful', 'authentication successful',
  'успешно вошли', 'успешная авторизация', 'вы вошли',
  'you are now authenticated', 'авторизован успешно',
];

function needsRegister() {
  return Date.now() - lastRegisterAt >= REREG_MS;
}

function doRegister() {
  if (!CONFIG.mc.authPassword || authPending) return;
  authPending = true;
  setTimeout(() => {
    if (!bot?.entity) { authPending = false; return; }
    // ✅ Password typed TWICE for registration
    botChat(`/register ${CONFIG.mc.authPassword} ${CONFIG.mc.authPassword}`);
    lastRegisterAt = Date.now();
    dlog('📝 Registered', 'Sent `/register *** ***`  *(password twice)*\n✅ Re-registers automatically in **24 h**', 0x00ccff);
    setTimeout(() => { authPending = false; }, 8_000); // safety release
  }, 1_500);
}

function doLogin() {
  if (!CONFIG.mc.authPassword || authPending) return;
  authPending = true;
  setTimeout(() => {
    if (!bot?.entity) { authPending = false; return; }
    // ✅ Password typed ONCE for login
    botChat(`/login ${CONFIG.mc.authPassword}`);
    dlog('🔑 Login Sent', 'Sent `/login ***`  *(password once)*', 0x00ccff);
    setTimeout(() => { authPending = false; }, 8_000); // safety release
  }, 1_500);
}

function handleAuthMessage(raw) {
  if (!CONFIG.mc.authPassword) return;
  const lower = raw.toLowerCase();

  // Specific success phrases only — prevents false positive auth
  if (SUCCESS_KW.some(k => lower.includes(k))) {
    if (!isAuthenticated) {
      isAuthenticated = true;
      authPending     = false;
      dlog('✅ Authenticated', 'Bot is logged in and ready!', 0x00ff88);
      setTimeout(() => botChat('/gamemode creative'), 1_200);
    }
    return;
  }

  if (isAuthenticated || authPending) return;

  if (REGISTER_KW.some(k => lower.includes(k))) {
    needsRegister() ? doRegister() : doLogin();
    return;
  }
  if (LOGIN_KW.some(k => lower.includes(k))) {
    doLogin();
  }
}

// ═══════════════════════════════════════════════════════════
//  CLEANUP helpers
// ═══════════════════════════════════════════════════════════
function clearAllIntervals() {
  if (followInterval) { clearInterval(followInterval);  followInterval = null; }
  if (reregInterval)  { clearInterval(reregInterval);   reregInterval  = null; }
  stopWatchdog();
}

function destroyBot() {
  clearAllIntervals();
  followTarget    = null;
  isAuthenticated = false;
  authPending     = false;
  connectedAt     = null;

  if (bot) {
    bot.removeAllListeners(); // prevents ghost listeners on reconnect
    try { bot.quit('reconnecting'); } catch (_) {}
    bot = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  BOT FACTORY
// ═══════════════════════════════════════════════════════════
function createBot() {
  // Cancel any pending reconnect timer (e.g. if user ran !reconnect manually)
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  destroyBot();

  console.log(`[${ts()}] Connecting to ${CONFIG.mc.host}:${CONFIG.mc.port} (attempt #${reconnectAttempts + 1})…`);

  try {
    bot = mineflayer.createBot({
      host:     CONFIG.mc.host,
      port:     CONFIG.mc.port,
      username: CONFIG.mc.username,
      version:  CONFIG.mc.version || false,
      auth:     CONFIG.mc.auth    || 'offline',
      hideErrors: false,
    });
  } catch (e) {
    console.error(`[${ts()}] Failed to create bot:`, e.message);
    scheduleReconnect();
    return;
  }

  bot.loadPlugin(pathfinder);

  // ── spawn ─────────────────────────────────────────────
  bot.once('spawn', () => {
    resetBackoff();
    connectedAt = Date.now();

    const move = new Movements(bot);
    move.allowFreeMotion    = true; // pathfinder works mid-air (creative)
    move.canDig             = false;
    move.scafoldingBlocks   = [];
    bot.pathfinder.setMovements(move);

    discord.user?.setActivity(CONFIG.mc.host, { type: ActivityType.Playing });

    dlog('✅ Connected',
      `**Server:** \`${CONFIG.mc.host}:${CONFIG.mc.port}\`\n` +
      `**Username:** \`${bot.username}\`\n` +
      (CONFIG.mc.authPassword
        ? '⏳ Waiting for auth prompt from server…'
        : '⚡ No auth — setting creative mode…'),
      0x00ff88);

    // Reset intervals
    reregInterval = setInterval(() => {
      if (!isAuthenticated || !CONFIG.mc.authPassword || !needsRegister()) return;
      dlog('🔄 24 h Re-Register', 'Sending scheduled re-register…', 0x00ccff);
      isAuthenticated = false;
      doRegister();
    }, 60_000);

    // Fallback auth if server sends no prompt within 5 s
    setTimeout(() => {
      if (isAuthenticated || !bot?.entity) return;
      if (CONFIG.mc.authPassword) {
        needsRegister() ? doRegister() : doLogin();
      } else {
        isAuthenticated = true;
        setTimeout(() => botChat('/gamemode creative'), 800);
      }
    }, 5_000);

    resetWatchdog();
  });

  // ── All server packets — feed watchdog + auth ─────────
  bot._client.on('packet', () => resetWatchdog());

  // ── Server messages (system, action bar, auth prompts) ─
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    if (text) handleAuthMessage(text);
  });

  // ── Player chat → Discord (rate limited) ─────────────
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    // Some servers echo auth prompts through chat — handle them too
    handleAuthMessage(message);
    mirrorChat(username, message);
  });

  // ── Death ─────────────────────────────────────────────
  bot.on('death', () => {
    dlog('💀 Bot Died', `Auto-respawn: **${autoRespawn ? 'ON' : 'OFF'}**`, 0xff4444);
    if (!autoRespawn) return;
    setTimeout(() => {
      if (!bot) return;
      try {
        bot.respawn();
        // After respawn, auth state may need refresh on auth servers
        if (CONFIG.mc.authPassword) {
          isAuthenticated = false;
          authPending     = false;
          // Give server time to send auth prompt; fall back after 5 s if not
          setTimeout(() => {
            if (!isAuthenticated && bot?.entity) doLogin();
          }, 5_000);
        }
      } catch (_) {}
    }, 1_500);
  });

  // ── Kicked ────────────────────────────────────────────
  bot.on('kicked', (reason) => {
    const txt = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    console.warn(`[${ts()}] Kicked: ${txt}`);
    dlog('🚫 Kicked', `\`${txt.slice(0, 500)}\``, 0xff4444);
  });

  // ── Error ─────────────────────────────────────────────
  bot.on('error', (err) => {
    // Log it, but don't schedule reconnect here — 'end' always fires after 'error'
    console.error(`[${ts()}] Bot error: ${err.message}`);
    dlog('⚠️ Error', `\`${err.message.slice(0, 400)}\``, 0xff8800);
  });

  // ── End (always fires after error, kick, or manual quit) ─
  bot.on('end', (reason) => {
    stopWatchdog();
    clearAllIntervals();
    followTarget    = null;
    isAuthenticated = false;
    authPending     = false;
    connectedAt     = null;

    // Remove listeners to prevent event leaks, but don't null bot yet
    // (bot.on('end') has already fired, so listeners are spent)
    bot?.removeAllListeners();
    bot = null;

    const msg = String(reason || 'unknown');
    console.log(`[${ts()}] Disconnected: ${msg}`);
    discord.user?.setActivity(`Reconnecting… (#${reconnectAttempts + 1})`, { type: ActivityType.Watching });
    dlog('🔌 Disconnected',
      `Reason: \`${msg.slice(0, 300)}\`\n⏳ Reconnecting in **${Math.min(reconnectDelay, CONFIG.reconnect.maxDelay) / 1000}s** (attempt **#${reconnectAttempts + 1}**)…`,
      0xff4444);

    scheduleReconnect();
  });

  // ── Player join / leave ───────────────────────────────
  bot.on('playerJoined', ({ username }) => {
    if (username !== bot?.username)
      dlog('📥 Joined', `**${username}** joined`, 0x00ccff);
  });
  bot.on('playerLeft', ({ username }) => {
    if (username !== bot?.username)
      dlog('📤 Left', `**${username}** left`, 0x808080);
  });

  // ── Low health (30 s cooldown to avoid spam) ─────────
  bot.on('health', () => {
    if (!bot || bot.health > 4) return;
    const now = Date.now();
    if (now - lastHealthWarn < 30_000) return;
    lastHealthWarn = now;
    dlog('❤️ Low Health!', `HP: **${bot.health.toFixed(1)}** / 20 | Food: **${bot.food}**`, 0xff4444);
  });
}

// ═══════════════════════════════════════════════════════════
//  DISCORD — READY
// ═══════════════════════════════════════════════════════════
discord.once('ready', () => {
  console.log(`[${ts()}] Discord ready as ${discord.user.tag}`);
  mcChannel = discord.channels.cache.get(CONFIG.discord.channelId);
  if (!mcChannel) {
    console.error('[ERROR] Discord channel not found! Check CONFIG.discord.channelId');
    process.exit(1);
  }
  createBot();
});

discord.on('error', (e) => console.error('[Discord Error]', e.message));

// ═══════════════════════════════════════════════════════════
//  DISCORD — COMMANDS
// ═══════════════════════════════════════════════════════════
discord.on('messageCreate', async (msg) => {
  if (msg.author.bot)                                  return;
  if (msg.channelId !== CONFIG.discord.channelId)      return;
  if (!msg.content.startsWith(CONFIG.discord.prefix))  return;

  const parts = msg.content.slice(CONFIG.discord.prefix.length).trim().split(/\s+/);
  const cmd   = parts.shift().toLowerCase();
  const args  = parts;

  const botReady = !!(bot?.entity);
  if (!OFFLINE_OK.has(cmd) && !botReady) {
    return msg.reply({ embeds: [mkEmbed('❌ Bot Offline',
      `Bot is not connected.\nUse \`${CONFIG.discord.prefix}reconnect\` to reconnect.\nReconnect attempts: **${reconnectAttempts}**`,
      0xff4444)] });
  }

  const ok  = (t, d, c = 0x00ff88) => msg.reply({ embeds: [mkEmbed(t, d, c)] });
  const err = (d)                   => msg.reply({ embeds: [mkEmbed('❌ Error', d, 0xff4444)] });

  try {
    switch (cmd) {

      // ─── HELP ────────────────────────────────────────
      case 'help':
        return ok('📖 All Commands', [
          '**🔐 Auth**',
          '`!authstatus` — Auth state & re-register countdown',
          '`!forcelogin` — Force /login now',
          '`!forceregister` — Force /register now (password twice)',
          '',
          '**📍 Movement**',
          '`!goto <x> <y> <z>` — Pathfind to coordinates',
          '`!follow <player>` — Continuously follow a player',
          '`!stopfollow` — Stop following',
          '`!come` — Come to nearest player',
          '`!tp <player>` — Teleport via /tp',
          '`!look <x> <y> <z>` — Look at a position',
          '`!pos` — Show current position',
          '`!stop` — Stop all movement',
          '',
          '**🎒 Inventory**',
          '`!give <player> <item> [amt]` — Give item via /give',
          '`!invsee` — View bot inventory',
          '`!drop <item>` — Drop item(s) matching name',
          '`!clear` — /clear bot inventory',
          '',
          '**🏗️ Building**',
          '`!setblock <x> <y> <z> <block>` — Set a block',
          '`!fill <x1> <y1> <z1> <x2> <y2> <z2> <block>` — Fill region',
          '',
          '**⚡ Creative**',
          '`!fly` — Enable creative flight',
          '`!gm <mode>` — Set gamemode',
          '`!time <value>` — Set time (day/night/noon/0-24000)',
          '`!weather <clear|rain|thunder>` — Set weather',
          '`!summon <entity> [x y z]` — Summon entity',
          '`!kill [target]` — Kill target (default: all mobs)',
          '',
          '**💬 Chat**',
          '`!say <message>` — Send chat as bot',
          '`!cmd <command>` — Run any /command',
          '',
          '**🤖 Control**',
          '`!status` — Full bot status & uptime',
          '`!players` — List online players',
          '`!reconnect` — Force reconnect now',
          '`!respawn` — Manual respawn',
          '`!attack <name>` — Attack player/entity',
          '`!autorespawn <on|off>` — Toggle auto-respawn',
        ].join('\n'), 0x5865f2);

      // ─── STATUS ──────────────────────────────────────
      case 'status': {
        const pos  = bot?.entity?.position;
        const pStr = pos
          ? `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`
          : 'Unknown';
        const pl = Object.keys(bot?.players ?? {})
          .filter(n => n !== bot?.username).join(', ') || 'None';
        const uptime = connectedAt ? fmt(Date.now() - connectedAt) : 'N/A';
        const rereg  = lastRegisterAt
          ? fmt(Math.max(0, REREG_MS - (Date.now() - lastRegisterAt)))
          : 'On next auth prompt';

        return ok('📊 Bot Status', botReady
          ? `**Server:** \`${CONFIG.mc.host}:${CONFIG.mc.port}\`\n` +
            `**Username:** \`${bot.username}\`\n` +
            `**Position:** \`${pStr}\`\n` +
            `**HP:** ${bot.health?.toFixed(1)} / 20  |  **Food:** ${bot.food}\n` +
            `**Uptime:** ${uptime}\n` +
            `**Auth:** ${isAuthenticated ? '✅ Logged in' : '❌ Not logged in'}\n` +
            `**Re-register in:** ${rereg}\n` +
            `**Auto-respawn:** ${autoRespawn ? 'ON ✅' : 'OFF ❌'}\n` +
            `**Following:** ${followTarget ?? 'Nobody'}\n` +
            `**Players:** ${pl}`
          : `❌ Offline — reconnect attempt **#${reconnectAttempts}** pending`);
      }

      // ─── AUTH ────────────────────────────────────────
      case 'authstatus': {
        const rereg = lastRegisterAt
          ? fmt(Math.max(0, REREG_MS - (Date.now() - lastRegisterAt)))
          : 'On next auth prompt';
        return ok('🔐 Auth Status',
          `**Logged in:** ${isAuthenticated ? '✅ Yes' : '❌ No'}\n` +
          `**Auth pending:** ${authPending ? '⏳ Yes' : 'No'}\n` +
          `**Password set:** ${CONFIG.mc.authPassword ? '✅ Yes' : '❌ No'}\n` +
          `**Last register:** ${lastRegisterAt ? new Date(lastRegisterAt).toLocaleString() : 'Never'}\n` +
          `**Re-register in:** ${rereg}`,
          0x00ccff);
      }

      case 'forcelogin':
        if (!botReady) return err('Bot is not connected.');
        isAuthenticated = false;
        authPending     = false;
        doLogin();
        return ok('🔑 Force Login', 'Sending `/login ***`…', 0x00ccff);

      case 'forceregister':
        if (!botReady) return err('Bot is not connected.');
        isAuthenticated = false;
        authPending     = false;
        lastRegisterAt  = 0;
        doRegister();
        return ok('📝 Force Register', 'Sending `/register *** ***` (password **twice**)…', 0x00ccff);

      // ─── MOVEMENT ────────────────────────────────────
      case 'goto': {
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some(isNaN)) return err('Usage: `!goto <x> <y> <z>`');
        bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
        return ok('🚶 Pathfinding', `Going to **${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}**`, 0x00ccff);
      }

      case 'follow': {
        const name = args[0];
        if (!name) return err('Usage: `!follow <player>`');
        const target = bot.players[name];
        if (!target?.entity) return err(`**${name}** is not visible or nearby.`);

        followTarget = name;
        if (followInterval) clearInterval(followInterval);

        followInterval = setInterval(() => {
          if (!bot?.entity || followTarget !== name) {
            clearInterval(followInterval);
            followInterval = null;
            return;
          }
          const p = bot.players[name]?.entity;
          if (p) bot.pathfinder.setGoal(new GoalFollow(p, 2), true);
        }, 400);

        return ok('👣 Following', `Now following **${name}**\nUse \`!stopfollow\` to stop`, 0x00ff88);
      }

      case 'stopfollow':
        followTarget = null;
        if (followInterval) { clearInterval(followInterval); followInterval = null; }
        bot.pathfinder.setGoal(null);
        return ok('🛑 Stopped Following', 'No longer following anyone.', 0xff8800);

      case 'stop':
        followTarget = null;
        if (followInterval) { clearInterval(followInterval); followInterval = null; }
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        return ok('🛑 All Stopped', 'Movement and actions cleared.', 0xff8800);

      case 'come': {
        const near = Object.values(bot.players)
          .find(p => p.username !== bot.username && p.entity);
        if (!near) return err('No players visible nearby.');
        bot.pathfinder.setGoal(new GoalFollow(near.entity, 2), true);
        return ok('🏃 Coming!', `Heading to **${near.username}**`, 0x00ff88);
      }

      case 'pos': {
        const p = bot.entity.position;
        return ok('📍 Position',
          `**X:** ${p.x.toFixed(2)}  **Y:** ${p.y.toFixed(2)}  **Z:** ${p.z.toFixed(2)}`,
          0x00ccff);
      }

      case 'look': {
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some(isNaN)) return err('Usage: `!look <x> <y> <z>`');
        // Pass coordinates directly — no offset calculation needed
        await bot.lookAt({ x, y, z });
        return ok('👀 Looking', `Facing **${x}, ${y}, ${z}**`, 0x00ccff);
      }

      case 'tp': {
        const name = args[0];
        if (!name) return err('Usage: `!tp <player>`');
        botChat(`/tp ${name}`);
        return ok('✨ Teleporting', `To **${name}**`, 0x00ff88);
      }

      // ─── CHAT ────────────────────────────────────────
      case 'say': {
        const text = args.join(' ');
        if (!text) return err('Usage: `!say <message>`');
        botChat(text);
        return ok('💬 Said', `> ${text}`, 0x5865f2);
      }

      case 'cmd': {
        const command = args.join(' ');
        if (!command) return err('Usage: `!cmd <command>` (without `/`)');
        botChat(`/${command}`);
        return ok('⚡ Command Sent', `\`/${command}\``, 0x00ccff);
      }

      // ─── INVENTORY ───────────────────────────────────
      case 'invsee': {
        const items = bot.inventory.items();
        if (!items.length) return ok('🎒 Inventory', 'Inventory is empty.', 0xff8800);
        const lines = items.map(i =>
          `• **${i.name}** ×${i.count}  _(slot ${i.slot})_`
        ).join('\n');
        return ok('🎒 Inventory', lines.slice(0, 4000), 0x00ff88);
      }

      case 'give': {
        const [player, item, amount = 1] = args;
        if (!player || !item) return err('Usage: `!give <player> <item> [amount]`');
        const amt = parseInt(amount, 10);
        if (isNaN(amt) || amt < 1) return err('Amount must be a positive number.');
        botChat(`/give ${player} ${item} ${amt}`);
        return ok('🎁 Given', `**${amt}×** \`${item}\` → **${player}**`, 0x00ff88);
      }

      case 'drop': {
        const query = args[0];
        if (!query) return err('Usage: `!drop <item_name>`');
        const item = bot.inventory.items().find(i => i.name.includes(query));
        if (!item) return err(`No item matching **${query}** in inventory.`);
        await bot.toss(item.type, null, item.count);
        return ok('🗑️ Dropped', `**${item.count}×** \`${item.name}\``, 0xff8800);
      }

      case 'clear':
        botChat('/clear');
        return ok('🗑️ Cleared', 'Bot inventory cleared via `/clear`.', 0xff8800);

      // ─── BUILDING ────────────────────────────────────
      case 'setblock':
      case 'place': {
        const [x, y, z, block] = args;
        if (!x || !y || !z || !block)
          return err('Usage: `!setblock <x> <y> <z> <block>`');
        if ([x, y, z].map(Number).some(isNaN))
          return err('X, Y, Z must be numbers.');
        botChat(`/setblock ${x} ${y} ${z} ${block}`);
        return ok('🧱 Block Set', `\`/setblock ${x} ${y} ${z} ${block}\``, 0x00ff88);
      }

      case 'fill': {
        const [x1, y1, z1, x2, y2, z2, block] = args;
        if (!x1 || !y1 || !z1 || !x2 || !y2 || !z2 || !block)
          return err('Usage: `!fill <x1> <y1> <z1> <x2> <y2> <z2> <block>`');
        if ([x1, y1, z1, x2, y2, z2].map(Number).some(isNaN))
          return err('Coordinates must be numbers.');
        botChat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
        return ok('🏗️ Fill Sent', `\`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}\``, 0x00ff88);
      }

      // ─── CREATIVE ────────────────────────────────────
      case 'fly':
        // Set creative mode — flight is built into Minecraft creative
        botChat('/gamemode creative');
        return ok('🕊️ Flight Enabled', 'Set to creative — press **Jump twice** in-game to fly, or use `!goto` to pathfind through air.', 0x00ccff);

      case 'gm':
      case 'gamemode': {
        const mode = args[0];
        const valid = ['creative', 'survival', 'adventure', 'spectator', '0', '1', '2', '3'];
        if (!mode || !valid.includes(mode))
          return err(`Usage: \`!gm <${valid.slice(0, 4).join('|')}>\``);
        botChat(`/gamemode ${mode}`);
        return ok('🎮 Gamemode', `Set to **${mode}**`, 0x00ff88);
      }

      case 'time': {
        const t = args[0];
        if (!t) return err('Usage: `!time <day|night|noon|midnight|0-24000>`');
        botChat(`/time set ${t}`);
        return ok('🕐 Time Set', `Time → **${t}**`, 0x00ccff);
      }

      case 'weather': {
        const w = args[0];
        if (!['clear', 'rain', 'thunder'].includes(w))
          return err('Usage: `!weather <clear|rain|thunder>`');
        botChat(`/weather ${w}`);
        return ok('🌤️ Weather', `Weather → **${w}**`, 0x00ccff);
      }

      case 'summon': {
        const entity = args[0];
        if (!entity) return err('Usage: `!summon <entity> [x y z]`');
        const { x, y, z } = bot.entity.position;
        const pos = args.length >= 4
          ? `${args[1]} ${args[2]} ${args[3]}`
          : `${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`;
        botChat(`/summon ${entity} ${pos}`);
        return ok('👾 Summoned', `**${entity}** at \`${pos}\``, 0x00ff88);
      }

      case 'kill': {
        const target = args[0] || '@e[type=!player]';
        botChat(`/kill ${target}`);
        return ok('💀 Kill', `Target: **${target}**`, 0xff4444);
      }

      // ─── PLAYERS ─────────────────────────────────────
      case 'players': {
        const pl = Object.keys(bot.players).filter(n => n !== bot.username);
        return ok('👥 Players Online',
          pl.length
            ? pl.map((n, i) => `${i + 1}. **${n}**`).join('\n')
            : 'No other players online.',
          0x00ccff);
      }

      // ─── BOT CONTROL ─────────────────────────────────
      case 'reconnect':
        await ok('🔄 Reconnecting', 'Tearing down and reconnecting now…', 0xff8800);
        resetBackoff(); // user-initiated = fresh start
        createBot();
        break;

      case 'respawn':
        if (!bot) return err('Bot is not connected.');
        try {
          bot.respawn();
          return ok('♻️ Respawned', 'Respawn command sent.', 0x00ff88);
        } catch (e) {
          return err(`Respawn failed: ${e.message}`);
        }

      case 'autorespawn': {
        const toggle = args[0]?.toLowerCase();
        if (!['on', 'off'].includes(toggle))
          return err('Usage: `!autorespawn <on|off>`');
        autoRespawn = toggle === 'on';
        return ok('⚙️ Auto-Respawn', `Now **${autoRespawn ? 'ON ✅' : 'OFF ❌'}**`, 0x00ccff);
      }

      case 'attack': {
        const name = args[0];
        if (!name) return err('Usage: `!attack <player|entity>`');
        const ent = bot.players[name]?.entity
          ?? Object.values(bot.entities).find(e => e.name === name || e.username === name);
        if (!ent) return err(`Cannot find **${name}** nearby.`);
        bot.attack(ent);
        return ok('⚔️ Attacked', `Hit **${name}**`, 0xff4444);
      }

      default:
        return err(`Unknown command \`${cmd}\`. Use \`${CONFIG.discord.prefix}help\` to see all commands.`);
    }
  } catch (e) {
    console.error(`[${ts()}] Command error (${cmd}):`, e);
    try {
      await msg.reply({ embeds: [mkEmbed('💥 Command Failed',
        `\`${(e?.message ?? String(e)).slice(0, 300)}\``, 0xff4444)] });
    } catch (_) {}
  }
});

// ═══════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════
console.log(`\n╔══════════════════════════════════════╗`);
console.log(`  Minecraft Discord Bot  v3.0`);
console.log(`  Server  : ${CONFIG.mc.host}:${CONFIG.mc.port}`);
console.log(`  Username: ${CONFIG.mc.username}`);
console.log(`  Auth    : ${CONFIG.mc.auth} | Password: ${CONFIG.mc.authPassword ? 'set ✓' : 'none'}`);
console.log(`╚══════════════════════════════════════╝\n`);

discord.login(CONFIG.discord.token);
