# General Quarters

Browser RTS of Second World War Pacific naval combat: plays like Red Alert 2, with a realistic simulation underneath. TypeScript + Three.js + Vite, deployed to GitHub Pages from `main` by `.github/workflows/deploy.yml`.

**Read `docs/DESIGN.md` first.** It is the master design document: the vision, every decision made so far, the scale rules, the combat model, the roadmap and open questions. Keep it up to date when decisions change.

## Commands

```bash
npm install
npm run dev      # dev server
npm run build    # tsc --noEmit + vite build (must pass before pushing)
npx esbuild scripts/balance.ts --bundle --platform=node --format=esm --outfile=/tmp/balance.mjs && node /tmp/balance.mjs   # headless balance check
```

Run the balance check after changing anything in `src/data/` or `src/sim/`, and report the numbers.

## Layout

- `src/config.ts`: scale constants (`RANGE_SCALE`, `FLIGHT_TIME_SCALE`, `SHIP_VIS_MAX`).
- `src/data/`: gun tables (indexed by **real** range in km) and ship classes (true dimensions, armour, turret layout, visual parts).
- `src/sim/`: simulation; **must not import three.js**, so it can run headless. `ship.ts` covers movement and fire control, `combat.ts` covers hit tracing and armour, `world.ts` covers the loop, salvos and the hit estimate, and `hull.ts` covers hull geometry.
- `src/render/`: Three.js scene, procedural ship models (`shipModel.ts`, merged by `kit.ts`), effects, 2D overlay.
- `src/ui/hud.ts`: sidebar panels.

## Conventions

- World axes: x east, z south. Bearings are radians, clockwise from north (-z): `dir(b) = [sin b, -cos b]`.
- Ship-local frame: x (u) forward, z (v) starboard, y up; heading to rotation is `rotation.y = PI/2 - heading`.
- Game distances are compressed; convert with `toReal()`/`toGame()` before any ballistic lookup. Show players real-equivalent distances.
- Ships keep true size in the simulation; visual enlargement (`ship.vs`) is rendering only.
- Gun and armour numbers are approximations; note the source when refining them.
