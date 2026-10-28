# Button Game Render Worker

A small Node.js worker that watches one configured game and presses **only the player identified by `myPlayerId` for the configured session**.

## Important session requirement

The frontend calls `GET /api/session` and then uses same-origin session credentials. The game API response must identify your claimed character in `myPlayerId`. If it returns `null`, this worker deliberately refuses to press any player.

`SESSION_COOKIE` must contain the session cookie(s) from the browser session that owns your character in this game. Treat this value as a password: anyone with it may be able to act as that session. Store it only as a Render secret environment variable, never commit it to Git or share it in chat. If the site uses a server-managed session that cannot be reused outside the browser, this worker will not be able to act as your browser identity.

## Deploy on Render

1. Put these files in a private GitHub repository.
2. In Render, choose **New + → Blueprint** and connect that repository. Render will read `render.yaml`.
3. Set the environment variables:
   - `GAME_ID`: `6f1fe536-5dfa-4460-a9a7-bcf9c7f2fd01`
   - `SESSION_COOKIE`: the cookie header value for the browser session that owns your claimed character (see note below).
   - `TARGET_HOURS`: `23` means press after 23 full hours elapsed since the last press, earning up to 23 points while leaving roughly one hour before the deadline. Use a different value from 0 to 23 if you intentionally want a different schedule.
   - `POLL_SECONDS`: default `60`.
   - `PRESS_BUFFER_SECONDS`: default `5`; the worker sends the press once the target is reached, allowing a small buffer for polling.
4. Deploy and inspect the Render logs. If `myPlayerId` is null, stop the worker and fix the session configuration; do not set a different player's ID to bypass that guard.

### Finding the session cookie

Only do this on your own account/session. In browser DevTools, open **Application/Storage → Cookies** for the game site and inspect the site's session cookie. Copy only the cookie name/value pair(s) needed by the site into Render's `SESSION_COOKIE` secret. Do not share the value with anyone. Cookie names vary by deployment, so this project does not guess a cookie name.

## Timing and safeguards

- The frontend API route is `POST /api/games/{gameId}` with JSON body `{"action":"press","playerId":...}`.
- The worker uses the API's `serverNow`, `lastPress`, `deadline`, and `myPlayerId`, rather than relying on the worker machine's clock.
- It refuses to act if the game is finished, your player is missing/unclaimed/eliminated, or the session does not resolve to a player.
- The default target is 23 hours after the last press, because the frontend rules say points accrue per full hour and cap at 23. It is configurable.
- This is an unofficial automation script. The server may reject automated requests or change its API. Review the game's rules and use only for your own character.
