const BASE_URL = (process.env.BASE_URL || "https://button-game.danb1983.chatgpt.site").replace(/\/+$/, "");
const GAME_ID = process.env.GAME_ID;
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const TARGET_HOURS = Number(process.env.TARGET_HOURS || 23);
const POLL_SECONDS = Math.max(10, Number(process.env.POLL_SECONDS || 60));
const PRESS_BUFFER_SECONDS = Math.max(0, Number(process.env.PRESS_BUFFER_SECONDS || 5));

if (!GAME_ID) throw new Error("Missing GAME_ID environment variable.");
if (!SESSION_COOKIE) throw new Error("Missing SESSION_COOKIE environment variable.");
if (!Number.isFinite(TARGET_HOURS) || TARGET_HOURS < 0 || TARGET_HOURS > 23) {
  throw new Error("TARGET_HOURS must be between 0 and 23.");
}

const cookie = SESSION_COOKIE.trim();
const headers = {
  "Cookie": cookie,
  "Accept": "application/json",
  "User-Agent": "button-game-personal-worker/1.0"
};

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store"
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function tick() {
  // Initialize/validate the site's session using the same endpoint as the frontend.
  await api("/api/session");
  const game = await api(`/api/games/${encodeURIComponent(GAME_ID)}`);

  if (game.finishedAt !== null) {
    console.log(`[${new Date().toISOString()}] Game is finished; worker will stop.`);
    process.exit(0);
  }
  if (game.startedAt === null) {
    console.log(`[${new Date().toISOString()}] Game has not started yet; checking again later.`);
    return;
  }

  // Never act on another player's character. The session must resolve to this user's player.
  const playerId = game.myPlayerId;
  if (playerId === null || playerId === undefined) {
    throw new Error("This session has no myPlayerId for this game. The SESSION_COOKIE is not the session that owns a claimed character, or no character is claimed. Refusing to press any player's button.");
  }

  const player = (game.players || []).find(p => p.id === playerId);
  if (!player || !player.claimed) {
    throw new Error(`myPlayerId ${playerId} is not a claimed player in this game. Refusing to press.`);
  }
  if (player.eliminatedAt !== null) {
    console.log(`[${new Date().toISOString()}] Your character is eliminated; worker will stop.`);
    process.exit(0);
  }
  if (player.lastPress === null || player.deadline === null) {
    console.log(`[${new Date().toISOString()}] No active timer for your character yet; checking again later.`);
    return;
  }

  const serverNow = Number(game.serverNow);
  const elapsedMs = serverNow - Number(player.lastPress);
  const targetMs = TARGET_HOURS * 60 * 60 * 1000;
  const deadlineMs = Number(player.deadline);
  const timeUntilTarget = targetMs - elapsedMs;
  const timeUntilDeadline = deadlineMs - serverNow;

  if (timeUntilDeadline <= 0) {
    console.warn(`[${new Date().toISOString()}] Your deadline has passed. Not pressing; check the game.`);
    return;
  }

  if (timeUntilTarget > PRESS_BUFFER_SECONDS * 1000) {
    const waitSeconds = Math.ceil(timeUntilTarget / 1000);
    console.log(`[${new Date().toISOString()}] ${player.name} (id ${playerId}): ${(elapsedMs / 3600000).toFixed(2)}h elapsed; target ${TARGET_HOURS}h in ${waitSeconds}s; deadline in ${Math.ceil(timeUntilDeadline / 1000)}s.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Target reached for ${player.name} (id ${playerId}); sending one press.`);
  const result = await api(`/api/games/${encodeURIComponent(GAME_ID)}`, {
    method: "POST",
    body: JSON.stringify({ action: "press", playerId })
  });

  const updated = (result.players || []).find(p => p.id === playerId);
  console.log(`[${new Date().toISOString()}] Press accepted. earned=${result.earned ?? "unknown"}; updatedScore=${updated?.score ?? "unknown"}; newLastPress=${updated?.lastPress ?? "unknown"}`);
}

console.log(`Button-game worker started. Game=${GAME_ID}, target=${TARGET_HOURS}h, poll=${POLL_SECONDS}s.`);
console.log("The worker only presses the player identified by the site's myPlayerId for the configured session.");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopping = true; console.log(`Received ${signal}; stopping after current cycle.`); });
}

while (!stopping) {
  try {
    await tick();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${error.message}`);
  }
  if (!stopping) await sleep(POLL_SECONDS * 1000);
}
