# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

«Финансовый магнат» — an idle/tycoon browser game in vanilla HTML/CSS/JS (ES modules, no frameworks, no dependencies, no build step). All UI text, code comments, and toasts are in **Russian** — keep it that way.

## Running

There is no package.json, linter, or test suite. The code deliberately uses **classic scripts, not ES modules** — no `import`/`export` — so `index.html` opens directly via `file://` (double-click) and deploys to GitHub Pages as-is. Do not convert files to ES modules; that would break `file://` launch.

Consequence: script load order in `index.html` **is** the dependency graph (config → utils → data → core → ui → main). A new JS file must be added to the `<script>` list there in the right position. All top-level `const`/`class` names share one global scope — keep them unique across files.

**Cache busting:** every `<script>`/`<link>` in `index.html` carries a `?v=N` query. **Bump N whenever you ship changed files** — browsers cache these aggressively (both over http and `file://`), and a stale mix of old and new files produces confusing runtime errors. If a code change appears to have no effect while testing, suspect the cache first and check `SomeClass.prototype.method.toString()` in the console.

Optionally serve over HTTP: `python3 -m http.server 8123` (config exists in `.claude/launch.json`, name `idle-tycoon`).

**Debugging:** `window.game` is exposed in the console. Useful patterns:
- `game.state.balance += 100000` — test money
- `game.state.props.garage.nextOfferAt = Date.now()` — force a tenant offer now
- `game.state.applyOffline(7200)` — exercise the offline-progress path directly
- Save lives in `localStorage` under `financial-tycoon-save`; note the `beforeunload` handler re-saves on reload, so patching `lastTimestamp` in localStorage to test offline income gets overwritten unless you bypass it.

## Architecture

One-way data flow; UI never mutates state directly:

```
config.js + data/*  ──►  GameState (core/gameState.js — single source of truth)
                           │  emits: 'tick' | 'market' | 'structural' | 'toast' | 'dirty'
                           ▼
              ui/* views (read state, call state methods)
GameState.serialize()/hydrate() ◄──► StorageManager (core/storage.js)
```

- **`js/config.js`** — every tunable number (wear rates, fees, lease durations, event frequency, upgrade multipliers). Balance changes happen here, not in logic.
- **`js/data/`** — content as data: `properties.js` (25 rental objects + tenant name pools), `market.js` (stocks/bonds/crypto), `forex.js` (13 currency pairs; also builds `ALL_SIM_ASSETS` — the list `MarketSim` actually simulates, since `MARKET_ASSETS` stays spot-only for portfolio logic), `deposits.js`, `businesses.js` (6 businesses with per-business mechanic configs), `prestige.js` (coin shop). Adding an asset = adding one record; UI and logic pick it up automatically (a new *business* additionally needs its mechanic wired in `GameState._bizTick`/`bizMechMult` and a UI block in `ui/businessView.js`).
- **`js/core/gameState.js`** — all game logic: rent/wear/leases, trades, deposits, random events, offline simulation. Every mutation goes through a method that emits events. `main.js` listens for `'dirty'` and saves.
- **`js/core/marketSim.js`** — price model: `price = anchor × mood`, anchor drifts up slowly (`growth`/day), mood is a log random walk with mean reversion clamped to `moodRange`. Random events call `shock()`; offline uses `advance(seconds)` with stationary-variance approximation.
- **`js/core/storage.js`** — `StorageProvider` interface (async `save/load/clear`) with `LocalStorageProvider` impl; `StorageManager` owns the save schema, `version` field, and migrations (`_migrate`, currently v1→v5). Bump `CONFIG.SAVE_VERSION` and add a migration step when changing the save shape. It takes a *second* provider (key `…-backup`) used by `backup()` before every import/reset so the player can roll back. `SaveCodec` encodes a save to a base64 string for export/import — it chunks the byte→string conversion because the save contains Cyrillic and can be tens of KB.

  `GameState.hydrate()` emits `structural('all')` **before** `tick` on purpose: loading a save changes which cards exist, and views keep DOM refs, so a tick against stale refs throws. This is invisible at startup (no listeners yet) but breaks import.
- **`js/ui/`** — views build DOM once and keep refs; per-second updates (`'tick'`) touch only text/timers/disabled states, while `'structural'` events (scoped: `realty`/`portfolio`/`deposits`/`all`) rebuild the affected section. `marketSection.js` is one class parameterized by kind (`stock`/`bond`/`crypto`).
- **`js/main.js`** — composition root: wires state↔storage↔UI, runs the loops (game tick 1s with real-elapsed `dt` so background-tab throttling doesn't lose income; market tick 3s; autosave 30s; random events every 15–40 min).

Extension points are marked with `// TODO` in code: new tab → config array in `main.js`; new investment section → `SECTIONS` in `ui/investmentsView.js`; new storage backend → new `StorageProvider` subclass swapped in `main.js`.

## Economy design (intentional, don't flatten)

Return-per-ruble hierarchy is deliberate so everything stays worth buying: deposits are safe but amount-capped; bonds yield more but have finite issue volume (`bondsRemaining`); dividend stocks add price risk; real estate has the best returns but demands management (tenants, wear, repairs, manager's 15% cut); businesses top the hierarchy — 25 levels with rank jumps (×1.5 every 5 levels) and per-business active mechanics, full upgrade costs ~340× the open price.

Achievements (`js/data/achievements.js`) pay out **gold coins**, deliberately: coins are painfully scarce early (a first prestige yields 1–2), so achievements let a player taste the perk shop long before their first rebirth. Total payout across all 45 is ~130 coins against a ~545-coin shop, so the prestige economy stays intact. Like coins and perks, achievements survive prestige and are wiped only by a full reset. `HomeView` shows the three closest unearned ones — that block, not the tab, is what answers "what do I do next", so keep it working.

Forex sits outside that hierarchy on purpose: it generates **no passive income** and is the only place where capital can actually shrink. It trades capital efficiency (leverage up to 1:100) against liquidation risk — a stop-out closes the position once the loss eats `FX_STOPOUT` of the margin, and payout is floored at 0 so a trader can never lose more than the posted margin. Spread is charged implicitly by opening longs at ask / closing at bid (never add a separate commission). Swap rates are per-pair *and* per-direction: one side may be positive (carry trade), but every pair's `swapLong + swapShort` is negative so holding is never free money. Exotic pairs pair a devaluation `growth` drift with a punishing long swap — that tension is the balance, don't remove one without the other. Cheap properties pay back in ~1.5h, the skyscraper in ~18h. Lease/deposit timers use real-world time (hours), and offline progress genuinely simulates lease expiry and manager re-letting — don't replace it with a flat `income × time` shortcut. Prestige: coins = floor(sqrt(netWorth / 1M)), quadratic thresholds are intentional.
