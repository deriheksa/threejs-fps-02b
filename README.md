# CINDERFALL — Slagworks Yard

A round-based tactical FPS in three.js (0.187.0), single-player against bots, played
offline from static files. You fight with two Sentinel allies against four Cinder bots
in an industrial yard with two bomb sites: Kiln (A) and Depot (B).

## How a round plays

- **Buy phase (15s):** spend the money you earned — rifles, SMGs, a shotgun, a DMR,
  grenades, kevlar. Press B for the shop.
- **Live (100s):** push a lane, plant the charge at a site (hold E inside the glowing
  ring), or eliminate the Cinder crew. If the charge is planted, a 35-second fuse
  starts and the Cinder bots converge to defuse it.
- **Win the round** by elimination, by detonation, or by stopping the defuse. First
  to 5 rounds takes the match (max 9 rounds).

## Controls

WASD move · mouse look · click fire · R reload · E plant (hold) · G grenade ·
B buy menu · 1–5 weapons · Ctrl crouch · Space jump.

## Files

- `game/` — the playable game (ES modules, three.js vendored under `game/vendor/three/`)
- `game/src/` — one module per job: world, body, guns, bots, match, hud, input,
  theme, util, boot
- `screenshots/` — three real renders of the game in a browser
- `main.ts` — hands the game in (copies game/ + screenshots/, writes dossier.json)
- `serve.ts` — `node serve.ts`, then open http://localhost:8080

MIT licensed.
