# General Quarters: design document

The master record of what this game is and what has been decided. Update it whenever a decision changes.

## 1. Vision

A real-time strategy game about **Second World War naval combat in the Pacific**, recreating actual engagements. It should **play like Red Alert 2** (select, click to attack, quick to read) while being **as realistic as possible** underneath: gunnery, armour, fire control, formations, visibility.

- Runs entirely in the browser (TypeScript, Three.js, Vite) and is hosted on **GitHub Pages**: static files, no server.
- **Single-player.** Multiplayer is out of scope for now. If it comes back, the simulation would need deterministic maths (seeded random numbers, no reliance on `Math.sin` being identical across browsers).

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Theatre | Pacific |
| Warfare | Surface ships, **carriers and aircraft**, **submarines** |
| Scenarios | Recreate historical engagements. Forces start already deployed; **no base building or economy** |
| Victory | **Fixed victory conditions** per scenario, based on objectives (protect or destroy, bombard, break through, survive or delay, find and strike first). A crippled ship counts toward victory. Time limits such as "clear the area before dawn". Withdrawing through an exit can earn a partial win. The historical result is shown on the results screen for comparison |
| Control | Individual ships. Several selected ships can be given **formation orders** |
| Gunnery | RA2-simple: select a ship, click a target. **The player never aims.** Accuracy and damage depend on the ship, range and the **angles** of firer and target. Positioning is the skill; going broadside is a risk/reward choice |
| Fog of war | What your ships would know, like RTS fog but about **contacts, not terrain**: identified, classified (silhouette only), detected (unknown blip with an uncertainty area), lost (last-seen marker). Sensors: visual, night, radar (by nation and year), sonar, aircraft. Tactical vision is shared instantly; long-range reports (scout planes, coastwatchers) arrive late and may be wrong. The enemy AI plays under the same fog |
| Secondary batteries | Fire **automatically** at enemy ships within their range (mainly destroyers and cruisers), independent of the main-battery target |
| Shell types | **The player chooses** AP or HE per ship (common/SAP where the nation used it; star shell at night). Changing type takes one or two salvos while the shells already in the hoists are fired. Scenarios may start a ship loaded with the wrong type (Hiei and Kirishima, 13 Nov 1942) |
| Ammunition | **Finite.** Each class carries a realistic magazine loadout per shell type (main, secondary and AA separately); the UI shows rounds left. Running dry is a real outcome |
| Anti-aircraft | Fires **automatically** at aircraft within range. Heavy (dual-purpose 5"), medium (40 mm) and light (20 mm) AA by range band |
| Friendly fire | The player cannot order it, but stray shells and torpedoes can hit friendly ships |
| Multiplayer | Not for now |

## 3. Scale (the central design problem)

Real engagements are fought at distances of hundreds of ship lengths, too far apart for an RTS screen. The solutions chosen:

- **Ships keep their true dimensions.** Hit testing uses the real hull.
- **Distances are compressed**: `RANGE_SCALE = 0.3` in `src/config.ts`. One game metre of separation stands for 3.3 real metres. **All ballistics (angle of fall, penetration, dispersion, time of flight) are looked up at the real-equivalent range**, so a 6 km game range behaves like 20 km. The UI always shows real-equivalent distances.
- Shell flight times are shortened (`FLIGHT_TIME_SCALE = 0.35`) for pace. Ship speeds are real.
- **Ships are drawn larger when zoomed out**: up to `SHIP_VIS_MAX` (3×), with beam and height boosted a little more. Enlargement is capped at 0.8 × (distance to the nearest ship) / (ship length), so crowded formations and moored pairs never overlap. Close up, ships are drawn at 1×.
- Splashes and hit markers near an enlarged ship are drawn scaled by the same factor, so near-misses still look like near-misses.
- **Semantic zoom**: close-up sprites → battle view → map symbols at strategic zoom. Carrier operations work on the zoomed-out layer.
- Aircraft altitude is drawn compressed (1:6) with ground markers. Accepted as reasonable for now; revisit once the air layer is playable.
- Time compression goes from pause up to 8× in the proof of concept, and up to 60× for carrier operations.

## 4. Combat model (implemented in the proof of concept)

See `README.md` for file pointers.

- **Fire control**: the director's aim point has a range error and a deflection error. Each spotted salvo shrinks the error (`spotKeep`); there is a floor plus salvo-to-salvo wander. The error grows while **your own ship turns**. The target's speed and course estimate is smoothed, so **enemy manoeuvres** cause misses. Radar ships correct faster than optical ones.
- **Ballistics**: every shell lands at the aim point plus dispersion (along the line of fire much larger than across it). A hit is found by tracing the shell's descent through the target's hull, turrets, superstructure and funnels. Target angle and the "danger space" of tall superstructure therefore come from geometry.
- **Armour**: obliquity from angle of fall, target aspect and belt inclination; penetration from range tables. Ricochet above 60–70° (only on plates thick enough to matter). Plates thinner than calibre/6 don't arm the fuse, giving over-penetrations. Detonations inside the belt or deck are **citadel hits**, which roll for magazine, machinery, steering or flooding.
- **Shell types and ammunition** (implemented): the player picks AP or HE for the main battery (buttons in the fire-control panel, key **F**). A change takes one or two salvos: each turret fires the round in its guns and the one in the hoist first. Magazines are finite, with placeholder loadouts of about 90–100 rounds per gun (`ammo` in `src/data/ships.ts`: North Carolina 540 AP / 360 HE, Kongō 480 AP / 240 HE); a turret with nothing of the ordered type stops firing. HE bursts on contact: it blows through plate up to `he.penMm` (80 mm for the 16-inch, 65 mm for the 14-inch) and bursts behind it, otherwise it bursts on the armour. It never reaches the machinery of an armoured ship, damages directors, uptakes and the bridge, jams turrets and starts many fires. System damage with repair timers (radar, secondaries, AA) is the next step.
- **Damage**: hit points as flotation and structure; fires and flooding drain them; listing; turrets can be knocked out or jammed; director damage; jammed rudder.
- **Planned: HE and system damage.** HE bursts on contact and mostly wrecks what is unarmoured. Hits on superstructure roll against the systems there: radar, main and secondary directors, secondary mounts, AA mounts, searchlights, communications. These are **temporarily disabled** (damage-control repair time) or, on heavy hits, destroyed, and the loss shows in play: no radar means optical-only fire control and worse night detection; lost secondaries or AA mounts stop firing in their arc. HE also starts more fires than AP. A ship can be put out of action without sinking (South Dakota, 14–15 Nov 1942). AP keeps the existing penetration model; Japanese Type 91 AP can hit below the belt from a slightly short fall.
- **Planned: HE and machinery.** On ships with a belt and armoured deck, HE **cannot damage machinery** directly (it bursts outside the citadel). It can hit **funnels and uptakes**, which spoils boiler draught and caps top speed until repaired (and may make heavy smoke), and its fires can slow the ship through smoke drawn into ventilation. On **unarmoured ships** (destroyers and similar) HE bursts inside the hull and rolls for machinery hits like any other hit; one 5-inch hit can stop a destroyer. **Steering** is its own damage location, more exposed than machinery on most classes (Hiei, 13 Nov 1942).
- **UI feedback**: hit chance per shell (Monte Carlo estimate), expected hits per salvo, where hits would land (zone breakdown), solution error, last salvo (over, short, straddle, hits), turret states, effective armour against penetration, and immune zones for both sides.
- **Balance** (`scripts/balance.ts`): about 17% per shell against a stationary target at about 18 km; Kirishima sinks in about 9 minutes of game time. With HE against Kirishima: no citadel hits, sinks in about half of 30-minute trials against a stationary target, mostly from fires, using most of the 360 HE rounds. Known issue: hit rates against moving or zig-zagging targets come out *higher* than against a stationary one, because the moving target closes the range. Needs retuning.

## 5. Art direction (approved in mockups)

- Real-time 3D with a fixed orthographic camera (56° pitch, north up), giving an RA2-like look.
- **Ships are built in code from class data** (`src/render/shipModel.ts`): hull with flare and bulges, sloped turrets, cage, tripod and pagoda masts, secondary guns, boats, cranes, catapults with floatplanes. One merged, vertex-coloured mesh per ship. The user asked for **more detail**, and the current level was approved.
- **Daytime look approved.** Night battles come later as a lighting mode.
- Battle-view ship size approved (about 3×).
- Sidebar panels are **collapsible**. The hit-chance breakdown is "good to have, but collapsible".
- **More ship detail is wanted** beyond the current approved level (e.g. textured plating, weathering, finer secondary and AA mounts).
- Real ship designs are public historical information; never copy other people's models, drawings or game assets.

## 6. Scenarios

| Scenario | Why | Notes |
|---|---|---|
| Naval Battle of Guadalcanal, 14–15 Nov 1942 | **Recommended first scenario**: Washington and South Dakota against Kirishima, cruisers and destroyers | Night action; extends the proof of concept |
| Savo Island, Aug 1942 | Compact night action, fog of war, torpedoes | Mockup exists |
| Surigao Strait, Oct 1944 | Crossing the T, torpedo runs | |
| Samar, Oct 1944 | Delaying action | |
| ~~Pearl Harbor, Dec 1941~~ | Was only a test of the carrier layer | Mockup exists. **Shelved**; not a planned scenario |
| Midway, Coral Sea | Carrier against carrier | Needs the air and operational layer |

## 7. Roadmap

0. ✅ **Gunnery proof of concept**: Washington vs Kirishima, one against one.
1. **Squadrons and formations** (next): several ships per side, box selection, column, line abreast and line of bearing, turning in succession vs turning together, fire distribution, crossing the T. Add cruiser and destroyer classes.
2. **Enemy captain AI**: manoeuvre to keep guns bearing, distribute fire, break off when damaged.
3. **Torpedoes and destroyers**: Long Lance spreads, combing tracks, screens.
4. **Visibility and night**: contact levels, searchlights, star shells, radar against optics, smoke.
5. **First historical scenario** (Guadalcanal, November 1942) with victory conditions and a results screen.
6. **Carriers and the air layer** (Midway, Coral Sea).

Alongside: unit tests for the simulation, a seeded random-number generator for replays, and checking gun and armour data against sources.

## 8. Mockups (private claude.ai artifacts)

- Savo Island night action (fog of war, angle-based gunnery UI): https://claude.ai/artifact/17hwvNny9QNMAZwwZFMdDf
- Pearl Harbor (daytime, carriers, air groups, detailed models): https://claude.ai/artifact/98SRWtxNS2Gte9rXbLfDaV
- Gunnery proof of concept preview: https://claude.ai/artifact/W7ntX4TdLJC6arc4t8awnq
- Live build: https://kevinandhwaboon.github.io/general-quarters/

## 9. Open questions

- When to schedule shell types, finite ammunition, system damage, and automatic secondary and AA fire (likely alongside squadrons, before torpedoes; AA needs aircraft first).
- Sources for per-class magazine loadouts (rounds per gun by shell type).
