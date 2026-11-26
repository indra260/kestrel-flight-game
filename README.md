[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/indra260/kestrel-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/indra260/kestrel-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

# Sky Courier — Valley Circuit

A chase-view flight game in plain static files. You fly the **Kestrel-9**, a
little orange courier plane, up a river valley: through sky gates, onto a
drop zone under parachute, and back down onto Runway 36 — on one tank of
fuel and one hull, if you fly the full circuit.

No build step, no dependencies, no network. Open `game/index.html` in a
browser, or serve it:

```
node serve.ts          # http://localhost:8080
```

## The flying

The view sits behind the aircraft. The HUD is a working instrument panel:
**altitude (AGL/MSL), speed, heading**, a compass strip, an artificial
horizon, and throttle / fuel / hull gauges, plus an objective arrow that
points at the next gate, the drop zone, or the runway.

The flight model has real discipline in it:

- **Throttle vs drag and gravity** — climbing costs speed, diving buys it.
- **Coordinated turns** — heading rate comes from bank and speed, so wide
  fast turns and tight slow ones feel different.
- **A stall** — slow down too much and the nose drops, the wing shakes, and
  the beeper sounds. Recover with speed, not hope.
- **Fuel** burns faster at full throttle and in the climb; run it dry and
  you glide. **Hull** damage from hard arrivals, gate clips and terrain
  is permanent for the sortie — and across all three legs of the circuit.

## The missions

1. **Ring Run** — take off from Runway 36 and thread eight gates up the
   valley. Clean passes build a combo; clips cost hull.
2. **Cargo Drop** — one parcel, one parachute, one painted target on the
   far field. Wind drift is real; drop early and flat. Bullseye pays 1,000.
3. **Landing Challenge** — a gliding approach back to Runway 36. The
   touchdown zone, centreline and sink rate decide the grade:
   PERFECT, GOOD, FIRM, or OFF FIELD.

**Full Circuit (C on the title screen)** flies all three back-to-back with
the same fuel and hull you finished the last leg with. Best scores per
mission — and for the circuit — are kept in `localStorage`.

## Controls

| Input | Effect |
| --- | --- |
| ↑ / ↓ | climb / descend |
| ← / →, A / D | bank and turn |
| W / S | throttle up / down (hold SHIFT for fine steps) |
| Mouse / touch drag | steer (pointer position flies the plane) |
| SPACE | drop the parcel / confirm |
| ENTER | confirm / start / next leg |
| P or ESC | pause |
| M | sound on/off |
| 1 / 2 / 3, C | choose a mission / full circuit (title screen) |
| R / T | restart / back to title (pause & results) |

All sound is synthesised live with WebAudio — engine hum that follows the
throttle, wind that follows the speed, gate chimes, a stall beeper, and the
thud of an honest arrival. There are no audio files.

## Structure

Everything is hand-written, one job per file:

```
game/
  index.html            the page: canvas, styles, screen-reader status line
  src/
    config.js           view, world, runway, aircraft, scoring, palette
    random.js           seeded RNG, cell hash, small math helpers
    terrain.js          the valley: river, coast, fields, landmarks
    flight.js           the flight model (throttle, turns, stall, fuel, contact)
    missions.js         Ring Run, Cargo Drop, Landing Challenge, scoring
    camera.js           the chase camera and the world→screen projection
    render.js           terrain mesh, runway paint, landmarks, the aircraft
    hud.js              instruments, warnings, title/pause/results screens
    input.js            keyboard + pointer, one-shot action flags
    audio.js            WebAudio synthesis: engine, wind, chimes, thuds
    shots.js            deterministic autopilot scenes for the screenshots
    main.js             the loop, the screens, the circuit, best scores
main.ts                 make.fun entry point: copies game/ + screenshots/
                        to the output dir and writes dossier.json
vendor/makefun-game.ts  the platform helper, byte-for-byte as supplied
serve.ts                a tiny local static server for game/
shots.json              what each screenshot scene shows and how to take it
screenshots/            real captures of the game, taken from the ?shot=
                        scenes in shots.js — unedited renders
```

## Screenshots

The four captures in `screenshots/` are the game itself, flown by the
autopilot scenes in `game/src/shots.js`: serve the game, open
`index.html?shot=takeoff` (or `rings`, `cargo`, `landing`), wait for
`window.__shotReady`, and capture the 1280×720 frame. Nothing is composited
or retouched.

## License

MIT — see `LICENSE`.
