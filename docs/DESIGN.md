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
| Focus | **Carriers first.** Carrier battles are the main interest; surface actions support them |
| Warfare | Surface ships, **carriers and aircraft**, **submarines** |
| Scenarios | Recreate historical engagements. Forces start already deployed; **no base building or economy** |
| Victory | **Fixed victory conditions** per scenario, based on objectives (protect or destroy, bombard, break through, survive or delay, find and strike first). A crippled ship counts toward victory. Time limits such as "clear the area before dawn". Withdrawing through an exit can earn a partial win. The historical result is shown on the results screen for comparison |
| Control | Individual ships. Several selected ships can be given **formation orders** |
| Selection (implemented) | RTS-style: click a ship, **Shift** adds or removes, **drag a box** with the left mouse button, number keys **1–9** pick a ship, **Q** selects all. Every order (helm, engage, shell type, hold fire, move) goes to **all selected ships**; the panels show the first one (the primary). A move order keeps the group's shape around the clicked point until formations exist. Right- or middle-drag pans (left-drag is the box); on touch screens drag pans and a long press orders a move |
| Formation spacing | **Half-compressed, set in ship lengths**: about 2.5 ship lengths bow to bow within a formation (about 550 game metres for a battleship), so ships are drawn at about 2× and a four-ship column is about 1.6 km long against 4–6 km ranges. The UI shows doctrine figures (e.g. "standard distance 1,000 yd"). Distances *between* groups (screens, separate divisions) are tactical and compress like range |
| Masking | Ships cannot fire through friendly hulls. Formation choice therefore matters: line abreast masks the beam, bunching silences guns |
| Escorts | **Screens.** Destroyers belong to their group's screen: real ships in the simulation (they fire, take hits, sink) that the game stations around the group and that fire at will. They are not selectable by default; the player can **detach** one for a job (picket, rescue, torpedo attack) and send it back to **rejoin**. Escorts stay at historical numbers; scenarios trim only ships that do nothing |
| Formation types | **Circle** (circular AA disposition: the guide, usually a carrier, at the centre, heavy ships on an inner ring, the screen on an outer ring; the default for a group with a carrier), **column** (surface actions, narrow waters) and **line of bearing** (what a turn together produces). Line abreast dropped. Turns **in succession** or **together**, plus **re-form** |
| Command level | Task groups. At strategic zoom the player orders task groups as single symbols; zoomed in, individual ships |
| Air scale | Aircraft fly at **real speeds over compressed distances**, like ships; fuel is counted in real-equivalent kilometres, so combat radii are historical and flights take about a third of the real time. Deck work (launch, recovery, arming) and deck repairs run on the same compressed clock (`AIR_TIME_SCALE = RANGE_SCALE`), and so do air-combat and AA kill rates and climb rates, which are set per real minute |
| Deck operations | Launch and recovery only **into a wind of at least 18 knots within 25° of the bow**, so carriers must turn away from the enemy to fly (the player has an Into wind order). One aircraft at a time (Yorktown 20 s to launch, 30 s to land, real), landed aircraft are fuelled and armed one at a time, a holed flight deck or three fires stop all flying. Recovery takes priority when aircraft are short of fuel |
| Air missions | **Search**: single aircraft fan out across an arc to their search radius, cross over and come home. **Strike**: every ready attack aircraft that can reach the point, plus the fighters not needed for patrol, one flight per type flying together to a **dead-reckoned aim point** that moves along the contact's track; if nothing is there they search around it, and they attack the most valuable ship they see (carriers first; dive bombers split between two carriers). **CAP**: fighters kept over the carrier automatically (player sets 0, 4, 8 or 12), replaced in sections of four, sent after detected raids that are still armed |
| Air combat | Fighters fight within reach and at a usable height: escorts stay with their bombers and take on fighters near them; patrols go for bombers but escorts tie them up; rear gunners fire back. Rates per aircraft per real minute (Zero slightly better than Wildcat). Torpedo bombers come in low, so a patrol that dives on them needs time to climb back (Midway) |
| Anti-aircraft | Every working AA mount fires at the nearest enemy flight in its reach (heavy 9 km, medium 3.5 km, light 1.8 km slant, real); IJN fire control rated lower in 1942. Flak also spoils the attackers' aim |
| Attacks and damage | Dive bombs and torpedoes hit by chance (aircraft, crew, target size, the target's turning, the torpedo's speed against the target's, flak). **Ships under air attack take evasive action on their own.** Torpedoes run visibly; the Mark 13 fails 30% of the time. On a carrier a bomb through the flight deck holes it (20–60 min real to repair), starts fires and destroys aircraft; **fuelled and armed aircraft aboard can explode** (US practice of draining fuel lines and stowing aircraft unarmed makes this much rarer than for the Japanese at Midway). Torpedoes flood and list the ship, can jam the rudder, break a destroyer in two, and start a carrier's aviation fuel leaking (vapour explosion later, Lexington). US damage control puts fires out faster |
| Fog of war (first version) | Ships see ships at about 30 km real (destroyers 70% of that) and aircraft at 25 km; air-search radar sees aircraft above 300 m at about 120 km (US ships; no Japanese radar in 1942). What own ships, or own aircraft within 15 km, see is shown exactly. **Scouts and strikes further out send reports** that arrive 5–15 min (real) late, about 5 km off, and often misidentify types (a carrier reported as a battleship, destroyers as cruisers); a scout shot down may not get her report off. Contacts show on the map with their age. The enemy AI plays under the same fog |
| Enemy carrier AI | Searches where the enemy is expected, keeps eight fighters up, strikes the freshest carrier report in range (any report after half an hour without a carrier), turns into the wind for flight operations and otherwise closes to about 160 nm |
| Fire distribution | **Later**, with the surface-warfare work. Until then: all on one target, or each ship on the nearest enemy |
| Orders inside a formation | Allowed. Fire orders (target, shell type, hold fire) apply without leaving the formation; a movement order (helm, move) takes that ship out of the formation, and the log says so |
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
- Time compression goes from pause up to 60× (20× and 60× for carrier operations).
- **Air timing** follows the same rule as ships: aircraft move at real speed over compressed distances, so everything on the air timeline (deck work, repairs, air combat, AA, climbing) runs at `AIR_TIME_SCALE` (0.3) of real time to keep the relative pace. Fuel is counted in real-equivalent distance.

## 4. Combat model (implemented in the proof of concept)

See `README.md` for file pointers.

- **Fire control**: the director's aim point has a range error and a deflection error. Each spotted salvo shrinks the error (`spotKeep`); there is a floor plus salvo-to-salvo wander. The error grows while **your own ship turns**. The target's speed and course estimate is smoothed, so **enemy manoeuvres** cause misses. Radar ships correct faster than optical ones.
- **Ballistics**: every shell lands at the aim point plus dispersion (along the line of fire much larger than across it). A hit is found by tracing the shell's descent through the target's hull, turrets, superstructure and funnels. Target angle and the "danger space" of tall superstructure therefore come from geometry.
- **Armour**: obliquity from angle of fall, target aspect and belt inclination; penetration from range tables. Ricochet above 60–70° (only on plates thick enough to matter). Plates thinner than calibre/6 don't arm the fuse, giving over-penetrations. Detonations inside the belt or deck are **citadel hits**, which roll for magazine, machinery, steering or flooding.
- **Shell types and ammunition** (implemented): the player picks AP or HE for the main battery (buttons in the fire-control panel, key **F**). A change takes one or two salvos: each turret fires the round in its guns and the one in the hoist first. Magazines are finite, with placeholder loadouts of about 90–100 rounds per gun (`ammo` in `src/data/ships.ts`: North Carolina 540 AP / 360 HE, Kongō 480 AP / 240 HE); a turret with nothing of the ordered type stops firing. HE bursts on contact: it blows through plate up to `he.penMm` (80 mm for the 16-inch, 65 mm for the 14-inch) and bursts behind it, otherwise it bursts on the armour. It never reaches the machinery of an armoured ship, damages directors, uptakes and the bridge, jams turrets and starts many fires. System damage is below.
- **System damage** (implemented): ships carry individual secondary and AA mounts (`secondaries`, `cas`, `aa` in the class data; one per side at each position) and, where fitted, a fire-control radar. Splinters from a burst on the upper deck or superstructure roll against the radar (if near the main mast and high) and every mount within about 12 m on that side. A hit system is **knocked out** for 1–3 minutes of damage-control repair (slower with fires aboard) or, one time in four, **destroyed**. HE rolls at full strength; AP passing through superstructure rolls at a third, AP bursting inside unarmoured spaces at about half. Low hull hits do not reach the upper deck. Losing radar falls back to optical fire control (slower corrections, wider error floor). A secondary mount that is out of action does not fire. Placeholder AA fits: Washington 4 × 1.1-inch quad, 20 × 20 mm; Kirishima 4 × 12.7 cm twin, 10 × 25 mm twin. Searchlights and communications are not modelled yet.
- **Secondary batteries** (implemented): engage the **nearest enemy ship within range** on their own, with HE, independent of the main-battery target and respecting hold fire. Each mount covers its own side from 20° off the bow to 20° off the stern. They have their own fire-control solution (`sec.fc` in the class data: US Mk 37 directors with radar are much better than Kongō's casemates under local control), fire in salvos and spot like the main battery, and draw on a finite pool of rounds (Washington 7,000 for twenty 5-inch/38; Kirishima 2,100 for fourteen 6-inch/50). HE blast and splinter effects scale with calibre (a 5-inch burst does about 40% of a 16-inch). Only hits that do something are logged, and they leave no fall-of-shot markers.
- **Damage**: hit points as flotation and structure; fires and flooding drain them; listing; turrets can be knocked out or jammed; director damage; jammed rudder.
- **Planned: HE and system damage.** HE bursts on contact and mostly wrecks what is unarmoured. Hits on superstructure roll against the systems there: radar, main and secondary directors, secondary mounts, AA mounts, searchlights, communications. These are **temporarily disabled** (damage-control repair time) or, on heavy hits, destroyed, and the loss shows in play: no radar means optical-only fire control and worse night detection; lost secondaries or AA mounts stop firing in their arc. HE also starts more fires than AP. A ship can be put out of action without sinking (South Dakota, 14–15 Nov 1942). AP keeps the existing penetration model; Japanese Type 91 AP can hit below the belt from a slightly short fall.
- **Planned: HE and machinery.** On ships with a belt and armoured deck, HE **cannot damage machinery** directly (it bursts outside the citadel). It can hit **funnels and uptakes**, which spoils boiler draught and caps top speed until repaired (and may make heavy smoke), and its fires can slow the ship through smoke drawn into ventilation. On **unarmoured ships** (destroyers and similar) HE bursts inside the hull and rolls for machinery hits like any other hit; one 5-inch hit can stop a destroyer. **Steering** is its own damage location, more exposed than machinery on most classes (Hiei, 13 Nov 1942).
- **UI feedback**: hit chance per shell (Monte Carlo estimate), expected hits per salvo, where hits would land (zone breakdown), solution error, last salvo (over, short, straddle, hits), turret states, effective armour against penetration, and immune zones for both sides.
- **Balance** (`scripts/balance.ts`): about 17% per shell against a stationary target at about 18 km; Kirishima sinks in about 9 minutes of game time. HE knocks out about three times as many of Kirishima's 28 mounts as AP (about 8 destroyed per fight against 2). With HE against Kirishima: no citadel hits, sinks in about half of 30-minute trials against a stationary target, mostly from fires, using most of the 360 HE rounds. Close duel at about 12 km with both sides firing: Washington's 5-inch guns score about 44 hits on Kirishima (historically roughly 40 on 14–15 Nov 1942) and leave about 10 of her 28 mounts out of action; Kirishima's casemates score about 9. 5-inch hit rates of about 10% at 12–15 km may be high; check when there are smaller targets. Squadron test (Washington leading South Dakota, about 2 km real apart, against Kirishima at about 12 km, all firing): Kirishima sinks in every trial after about 2 minutes, with about 11 main-battery hits from each battleship; she engages the nearest ship (here always South Dakota, hitting her about 5 times). Formations (from a loose start, 26 kn formation maximum): battleships settle on station within about a minute, destroyers within 3–4 minutes; turning 90° in succession, South Dakota passes over the guide's turning point and is never more than about 180 m off station. Masking in column with the screen ahead: South Dakota loses two turrets with the target within about 15° of the bow, and wing destroyers can mask Washington around 60°. Known issue: hit rates against moving or zig-zagging targets come out *higher* than against a stationary one, because the moving target closes the range. Needs retuning.

- **Air layer** (implemented, `src/sim/air.ts`, `carrier.ts`, `intel.ts`, `carrierAI.ts`; data in `src/data/aircraft.ts`): see the decisions table. Aircraft: F4F-4 Wildcat, SBD-3 Dauntless, TBD-1 Devastator; A6M2 Zero, D3A1 Val, B5N2 Kate. Carriers: Yorktown (CV-5, Midway air group, CXAM radar) and Shōkaku (Coral Sea); Kagerō-class destroyer. Calibration (`scripts/balance.ts`, 12 trials each, alerted target with eight fighters up and ships turning into the wind): a Yorktown strike (37 SBD, 13 TBD, 17 F4F) on Shōkaku scores about 5 bomb hits and under one torpedo, loses about 10 aircraft and kills about 7 Zeros; Shōkaku's deck is put out of action in 5–6 trials of 12 and she sinks in 3–5 (Coral Sea: 3 hits, survived). A Shōkaku strike (27 D3A, 18 B5N, 13 A6M) on Yorktown scores about 4 bombs and 1–2 torpedoes and loses about 20 aircraft; the US loses 14–20 fighters; Yorktown sinks in 4–6 of 12 (Lexington and Hornet territory). Single runs vary a lot, as the real battles did. AI against AI under fog, carriers 160 nm apart: both find the other in about 20–25 min; the Japanese find first more often (Kate searches reach 300 nm) and Yorktown is lost in about 7 of 12.

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
| Naval Battle of Guadalcanal, 14–15 Nov 1942 | Washington and South Dakota against Kirishima, cruisers and destroyers | Night action; extends the proof of concept. First **surface** scenario, after the carrier work |
| Savo Island, Aug 1942 | Compact night action, fog of war, torpedoes | Mockup exists |
| Surigao Strait, Oct 1944 | Crossing the T, torpedo runs | |
| Samar, Oct 1944 | Delaying action | |
| ~~Pearl Harbor, Dec 1941~~ | Was only a test of the carrier layer | Mockup exists. **Shelved**; not a planned scenario |
| **Coral Sea or Midway** | Carrier against carrier. **The first scenario** (carriers come first) | Needs the air and operational layer |
| Carrier trial (playable) | Yorktown and four Fletchers against Shōkaku and four Kagerōs, 150–190 nm apart, positions unknown; a two-hour-old patrol-plane report gives a rough bearing | Test scenario, not a historical order of battle. The squadron trial (battleships against Kirishima) is still selectable |

## 7. Roadmap

0. ✅ **Gunnery proof of concept**: Washington vs Kirishima, one against one.
1. **Squadrons and formations** (in progress, kept lean):
   - ✅ Several ships per side, multi-selection and group orders; squadron panel; South Dakota class (BB-57) added; enemy ships engage the nearest target and zig-zag independently.
   - ✅ Formations (`src/sim/formation.ts`): circle, column and line of bearing; the guide takes helm and speed orders and the others keep station (pure pursuit on the station, speed in proportion to the along-track error, a 1.5 kn reserve); a column turns in succession along the guide's track or together; re-form; ships that are sunk, have a jammed rudder or drop below 75% of the slowest class speed fall out, and the next ship in line takes over as guide.
   - ✅ Masking: a turret or secondary mount holds fire when a friendly hull (plus 30 m) lies across its line of fire; the fire-control panel shows "blocked: <ship>".
   - ✅ Destroyer screens: Fletcher class added; screens fire at will at the nearest enemy in range with HE, follow the guide's hold fire, can be detached one at a time and rejoin the nearest formation.
   - Controls: **C**, **B**, **O** form column, line of bearing or circle from the selection (destroyers go to the screen, the primary ship becomes the guide, the rest line up in order astern); **V** toggles turning in succession or together; **R** re-forms; **X** breaks. Clicking a screen destroyer selects her guide (Alt-click selects the destroyer); double-click selects a whole line. Station markers show where each ship should be.
2. **Carriers and the air layer** (in progress):
   - ✅ First slice: Yorktown and Shōkaku, six aircraft types, deck operations with wind, searches, strikes, CAP and escorts, air combat with altitude, AA from every mount, dive bombing and torpedoes, carrier damage (deck holes, hangar fires, armed-aircraft explosions, avgas), automatic evasive action, first fog of war with late and wrong scout reports, an enemy carrier AI, group symbols at strategic zoom, the carrier trial scenario.
   - Next: more carriers (Lexington, Enterprise and Hornet, Akagi, Kaga, Sōryū, Hiryū, Zuikaku) and cruisers with floatplanes (Japanese searches relied on them); land-based aircraft (Midway island, PBYs); weather and cloud cover for sighting; choosing squadrons for a strike and deferred against group departure; victory conditions.
3. **Visibility and fog of war**: contact levels, scout reports that arrive late or wrong, radar against optics; night, searchlights, star shells and smoke for the surface actions.
4. **First scenario: Coral Sea or Midway**, with victory conditions and a results screen.
5. **Surface warfare**: enemy captain AI, fire distribution, torpedoes and destroyer actions, cruiser classes, the moving-target hit-rate fix (§4), then Guadalcanal (November 1942).

Alongside: unit tests for the simulation, a seeded random-number generator for replays, and checking gun and armour data against sources.

## 8. Mockups (private claude.ai artifacts)

- Savo Island night action (fog of war, angle-based gunnery UI): https://claude.ai/artifact/17hwvNny9QNMAZwwZFMdDf
- Pearl Harbor (daytime, carriers, air groups, detailed models): https://claude.ai/artifact/98SRWtxNS2Gte9rXbLfDaV
- Gunnery proof of concept preview: https://claude.ai/artifact/W7ntX4TdLJC6arc4t8awnq
- Live build: https://kevinandhwaboon.github.io/general-quarters/

## 9. Open questions

- When to schedule shell types, finite ammunition, system damage, and automatic secondary and AA fire (likely alongside squadrons, before torpedoes; AA needs aircraft first).
- Sources for per-class magazine loadouts (rounds per gun by shell type).
- Coral Sea or Midway as the first scenario.
- How much of a strike the player composes (whole air group, or squadron by squadron), and whether strikes can be redirected by radio after launch.
- Weather: cloud and rain squalls hid carriers (Coral Sea); worth modelling before the first scenario.
