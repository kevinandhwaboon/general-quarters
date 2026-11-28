# General Quarters

A browser real-time strategy game about Second World War naval combat in the Pacific, built with TypeScript, Three.js and Vite, and hosted as a static site on GitHub Pages.

The current build has two test scenarios (pick one at the top). The **carrier trial** pits Yorktown against Shōkaku somewhere over the horizon: turn into the wind, send out a search (Search, then click the map), strike the contact your scouts report (Strike, then click it) and keep fighters overhead. The **squadron trial** is the gunnery proof of concept grown into squadron play: USS Washington and USS South Dakota in column, screened by four Fletcher-class destroyers, against Kirishima. **C**, **B** and **O** form column, line of bearing or circle; **V** switches between turning in succession and together; **R** re-forms; **X** breaks formation. Select ships with a click, Shift-click, a dragged box, the number keys or **Q** (all); orders go to every selected ship. Right-click orders a move or engages, right- or middle-drag pans, the wheel zooms.

## Run it

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check and build to dist/
```

Pushing to `main` deploys `dist/` to GitHub Pages through `.github/workflows/deploy.yml` (enable Pages with the "GitHub Actions" source in the repository settings).

`scripts/balance.ts` runs headless duels and prints hit rates and time to sink:

```bash
npx esbuild scripts/balance.ts --bundle --platform=node --format=esm --outfile=/tmp/balance.mjs && node /tmp/balance.mjs
```

## How the simulation works

- **Scale** (`src/config.ts`): ships keep their true size; distances are compressed (`RANGE_SCALE = 0.3`). Ballistics are always looked up at the real-equivalent range.
- **Fire control** (`src/sim/ship.ts`): the director has a range and deflection error that shrinks as salvos are spotted, grows while your own ship turns, and lags when the target changes course or speed. Radar ships correct faster.
- **Ballistics** (`src/sim/world.ts`): each shell lands at the aim point plus dispersion. Hits are found by tracing the shell's descent through the target's hull, superstructure, turrets and funnels (`src/sim/hull.ts`), so target angle and danger space come from geometry, not a lookup table.
- **Air layer** (`src/sim/air.ts`, `carrier.ts`, `intel.ts`, `carrierAI.ts`): deck operations into the wind, searches, strikes, combat air patrol, air combat, AA, dive bombing and torpedoes, carrier damage, a first fog of war with late and inaccurate scout reports, and an enemy carrier admiral playing under the same fog.
- **Armour** (`src/sim/combat.ts`): obliquity from the angle of fall, target aspect and belt inclination; penetration from range tables (`src/data/guns.ts`); ricochets; fuse arming on thin plates (over-penetrations); citadel hits roll for magazines, machinery, steering and flooding.

Gun and armour figures are approximations and should be checked against primary sources before they are relied on.
