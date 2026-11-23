# BJKIT2026: ICTP coding camp (website + board game)

Read this first in a new chat. It is the summary of how the whole system fits together and what is decided / still open.
Update it when a decision changes.

## The two halves

| Part | Where | What |
|---|---|---|
| Coding game (website + server) | repo root: `server.js`, `clans.js`, `students.js`, `public/`, `data/` | C/C++ missions solved in the browser, scored per clan. Node, no npm packages: `node server.js` (or `start.bat`), port 3000. |
| Board game (Unity) | `Game/BJKIT/` (Unity 6000.6.0f1, URP 17.6) | Western desert board: clans spend money on dice rolls to move between nodes. To be shown on the website's main page (`public/index.html`, `#map-canvas`). |

## Coding game (server side, already working)

- **Clans**: 6 teams in `clans.js` (`CLANS`): erawan, mayurawentai, nakkharat, bandhu-ratchasi, kilen, khrutha. Logos in `public/clans/<id>.svg`.
- **Students**: roster `data/students.json` (username, name, grade, clan, passwordHash), logins in `data/sessions.json` (cookie `sid`). A request's clan is decided only by `clans.clanOf(req)`.
- **Missions**: one file per problem `data/problems/<id>.json` (difficulty 0-6 or `"special"`, mode `solo` | `coop`), hidden tests in `data/tests/<id>[.p1|.p2].json`. Co-op = Player 1 / Player 2 parts with their own tests.
- **Points** (`clans.js`): level 0 = 0 (examples), 1 = 5, 2 = 20, 3 = 30, 4 = 60, 5 = 120, 6 = 200. Partial credit = points × share of hidden tests passed (rounded down). Special missions are all-or-nothing: first clan to clear = 50, later clans = 20.
  - Plan: all normal missions together add up to **1000 points**.
- **Money** = clan score + admin adjustments (`moneyAdjust`, Admin → Clans). Never below 0. Spending money does NOT lower the score. Nothing spends money yet (the board will: dice + shop).
- **Hints**: 3 per clan, shared; a revealed hint stays open for the clan.
- **Camp timer**: `data/timer.json`, set in Admin. At 0, Submit is locked (points freeze).
- **Main API**: `GET /api/clan/state` (score, money, solved, progress… for the logged-in student's clan), `GET /api/clans`, `GET /api/problems`, `POST /api/submit`, `GET /api/timer`, admin routes under `/api/admin/*` (money: `POST /api/admin/clans/<id>/money {amount}`).
- **Pages**: `public/index.html` = main page (map area `#map-canvas` shows the Unity board, + floating Missions panel), `play.html` = solve a mission, `admin.html`, `how-it-works.html`, `guide.html`. Shared JS in `public/js/` (`clan.js` handles login/clan chip).
- Static files are served from `public/` by `serveStatic` in `server.js` (MIME table `MIME` near line 485).

## Board game (Unity, `Game/BJKIT/`)

### Scene `Assets/Scenes/SampleScene.unity`
- Terrain 180 × 100 m (widened from 100), centre at world (8.5, 6.7). Ground is still Unity's checker placeholder (no terrain layer yet).
- Camera: **45° bird's-eye** (user's choice), heading 180 (looks from +Z toward -Z, so **sketch right = world -X** and **sketch down = world +Z**). `Scripts/Board/BoardCameraFit.cs` on the Main Camera keeps pitch/yaw and moves the camera in/out so the whole board fits whatever size the web page gives it (`margin`, `aimOffset` to tweak).
- Props come from `ICTP camp game map assests.fbx` (scale 50): mesas (Hill/Sanded) = sketch mountains, DeadTree1/2 = sketch trees, cacti/fence/sign/bone arch around the saloon gap in the centre, skull enlarged (scale 200) next to the bottom-right special. Buildings 1-4 and 2.2 were placed in the centre by the user (Building1 floats ~4 m above the sand).

### Node system (`Assets/Scripts/Board/`, namespace `BJKIT.BoardGame`)
- `BoardNode`: `id` (n01…n62, stable, shared with the server), `type` (Normal, Special, Event, Shop, Start), `links` (two-way).
- `Board`: rules + visuals.
  - `startNode`, `rollCost` = 20, `diceFaces` = **2,3,3,4,4,5** (balanced die: same 3.5 average as a d6, half the luck spread), `stopOnSpecial` = true (walking onto a yellow ends the move), `bounceAtDeadEnd` = true, no turning back otherwise.
  - `Paths(from, cameFrom, steps)` lists every legal walk; `Distance(a, b)` = BFS steps; `RollDie()`.
  - Visuals: navy discs (normal), glowing yellow discs (special), navy + yellow ring (event), yellow diamond (shop), big ringed disc (start); lines are flat navy LineRenderer ribbons following the dunes. Moving a node in the editor snaps it to the terrain and redraws lines (`liveEdit`).
- Editor tools (`Assets/Editor/BoardSketchBuilder.cs`), menu **Tools → Board**:
  - **Build From Sketch**: widens terrain, rebuilds all nodes/links from the sketch pixel coordinates, enlarges the skull (replaces an existing `Board` object).
  - **Rebuild Visuals**: after changing node types or moving nodes.
  - **Export board.json**: writes the graph (ids, types, links, start, rules) to `data/board.json` for the server (not exported yet).
- Map from the user's hand-drawn sketch: 62 nodes (5 yellow specials, 12 events, 3 shops, 1 start, 41 normal), 63 links, only 2 loops, 6 dead ends, 7 junctions. Start = node next to the saloon (sketch pixel 645,463). Events/shops placement is my proposal (dead ends without a special are events).

### Railway and placeholders (v3)
- Node types now also `Station` (brown wooden platform) and `Tunnel` (light blue disc). `BoardNode.label` = player-facing name (specials, stations, Saloon, Gold Panning). `BoardNode.railLinks` = train destinations.
- Railway ring: West Station n44 ↔ North Station n17 ↔ River Station n83 ↔ Mine Station n94 ↔ West. Rule: a clan that ENDS its move on a station may pay `Board.rideCost` (10) to ride to a neighbouring station (a teleport, not a walk). `Board.RailDestinations(node)`, `Board.RailLink(a, b)`. board.json has `"rail": [...]` and `"rideCost"`.
- Mine tunnel = the two Tunnel nodes joined by an ordinary 1-step link under the big mesa (a money cost for it is still only an idea).
- Landmarks with no model yet = empty GameObjects with a `BoxCollider` + `PlaceholderBox` (editor-only gizmo with the name), under `Landmarks (placeholders)`: PH River 1-8 (river strip from the waterfall to the bottom edge), PH Waterfall, PH Gold Panning Camp, PH Mine Entrance, PH Mine Tunnel, PH West/North/River/Mine Station. Put the real model in and delete the component.
- Builder data (`BoardSketchBuilder.cs`) was generated from the balance script; sketch→world: 0.152 m/px, sketch centre (691.5, 401) → world (8.5, 6.7). `PlaceLandmarks()` moves the fbx props to their landmark spots (absolute scales: mesa 26, small mesa 25, skull 150, DeadTree1 38, Rock3 33; the user's buildings are grouped as the saloon town around the start). After a rebuild, no prop or placeholder sits on a node (checked).

### Balance (simulated, greedy routing, 3000 runs)
- Specials from start: 5, 11, 13, 13, 15 steps; shortest tour of all five = 61 steps.
- With a d6: all 5 specials take median 24 rolls (480 money); luckiest 1% = 19 rolls; even all 6s = 13 rolls (stopOnSpecial caps streaks). Balanced die: lucky 10% 22 / median 24 / unlucky 10% 25.
- Money → board: 200 pts ≈ 2 specials, 400 ≈ 3.5, 500+ = all 5. Mid clans finish around camp end; strong clans (800+) run out of board halfway → need money sinks (shop/events).
- Problems: bottom-left special is only 5 steps from start (suggest moving it to the dead end 3 nodes right → distances 8, 11, 13, 13, 15); level-6 = 200 = 10 rolls at once (bursts); level-1 = 5 points = a quarter of a roll (slow start).
- Proposed server rules (not built): max ~3 rolls per clan per 15 min, and specials unlock on a schedule using the camp timer.

### Look (render settings, keep unless asked)
- Real desert noon, not a yellow filter: near-white sun (1, 0.95, 0.86) intensity 2.7 at 48°, Trilight ambient (blue sky / grey horizon / sand bounce), pale-blue fog, neutral grade (Neutral tonemapping, exposure +0.45, contrast 10, saturation 14), bloom threshold 1.5, SSAO tuned (falloff 300), shadows 200 m / 4096, depth of field OFF (camera ~90 m away).
- Blue procedural sky `Assets/Skyblokc/DesertSky.mat` on the camera's Skybox component (the HDRI `Day1.mat` stays for reflections).
- Heat haze: `Assets/Shaders/HeatHaze.shader` + `.mat`, Full Screen Pass on `PC_Renderer` (smooth upward-drifting noise, starts 55 m, full at 125 m).
- `Assets/Editor/CowboyLook.cs` (Tools → Lighting → Apply Cowboy Look) re-applies all of this; it auto-runs once per version key (`CowboyLook_Applied_vN`).

### Map v2 (user's new sketch + my proposal, NOT built in Unity yet)
- User's v2 sketch: 68 nodes / 70 links / 3 loops; 2 blue nodes (read as a tunnel pair) left of the big mountain; an unconnected cluster on the right with a 4th special and a river (bottom-right). Specials were 7 / 13 / 13 steps, each with one way in.
- My proposal (`Game/BJKIT/map-proposal-v2.png`, script in the chat): 87 nodes / 95 links / 9 loops, one dead end (gold-panning river spur). New: west trail (left special on a loop), top special linked to the top-middle loop, east loop around the right special, river bend, dry-riverbed trail along the bottom (bottom special moved out to its far end), blue mine tunnel. Specials 10 / 11 / 13 / 14 steps, each with a short and a long way in (+3 to +15 steps). 3 shops on hubs, 12 events mostly on the long routes.
- Rule ideas offered: standoff toll when landing on another clan, long routes carry the good events, tunnel costs money, mine-cart rail as a one-way express, shop items as late-game money sinks.
- Shortest tour of all 4 specials is 43 steps (old map 61): the game is faster, so roll caps / timed specials / shop sinks matter more.
- **v3 is BUILT in Unity** (2026-11-24) and exported to `data/board.json` (94 nodes, start `n53` = Saloon). Railway + placeholders added on top of the proposal, see "Railway and placeholders" below.
- **v3 (`Game/BJKIT/map-proposal-v3.png`)**: user wants **5 specials** and **landmarks**, and the bottom-left filled. Added the Abandoned Mine region: the west trail now runs south from the top-left special down a "frontier trail" (no longer cuts across to the left loop) to a 5th special at the mine, and a "mine rail" row joins it to the bottom trail. 94 nodes / 102 links, one dead end (gold panning).
  - Specials (steps from start, short / long way in): 1 Eagle Peak by the big mesa 13 / 25, 2 Dead Wood by the trees 13 / 17, 3 Waterfall by the river 14 / 17, 4 Skull Flats by the giant skull 11 / 14, 5 Old Mine 11 / 22. All 5 = 47-step tour.
  - Shape: west pair (1 + 5, 6 steps apart on the frontier trail), east pair (3 + 4, 8 apart), lone north (2) → clans pick a side, which spreads them out.
  - Landmarks from existing props: big mesa (Hill1/Sanded1), dead wood (DeadTree2), saloon at start (Buildings), giant skull, abandoned mine (Rail + MineCart props), river/waterfall (needs a new water mesh), mine tunnel through the mesa (blue pair), gold panning at the river source.

## Still open (ask the user before building)
1. Who rolls the dice and where: students' web page or the admin on the projector?
2. All six clans on one board (shared nodes)?
3. What the shop sells and what events do.
4. Server endpoints for the board (roll, move, positions) that charge `rollCost` via the money adjustment, plus the roll cap / timed specials above.
5. Ground texture: the terrain has no terrain layer, so web builds show plain white sand (the checker is editor-only). Offered a sand layer, not done.

## Board on the website (WebGL, working)
- Unity: **Tools → Board → Build Web (into website)** (`Assets/Editor/WebBuild.cs`) builds into `public/game/` (no compression, hashed file names, WebGL uses the "PC" quality level) and writes `public/game/build.json` with the file names. First build ≈ 15 min. The active build target is now WebGL.
  - From MCP, start it with `EditorApplication.delayCall += () => WebBuild.Build();` (a direct menu call times out the MCP connection). Don't start a build right after editing a script (Unity loops "Backend has requested a buildprogram run 6 times").
- Size: 50 MB raw (wasm 35 MB, data 16 MB); the HDRI `goegap_4k.exr` is capped at 512 px for WebGL only.
- `public/index.html`: a separate script at the end reads `game/build.json` and loads the game into `#map-canvas` (error text in the map if it fails; no build = empty map as before). `window.boardGame` = the Unity instance (for `SendMessage` later).
  - Layout: `.home` uses `data-panel="full"` (map column | Missions column), so the board only fills the space left of the Missions panel (user asked for this; the old floating panel covered the board).
  - Loading: the site's GIF loading screen (`js/loader.js`) stays up until Unity is ready, with a progress bar under the GIF. `PageLoader.holdUntil(promise, maxMs)` and `PageLoader.progress(p)` were added for this (other pages unchanged); cap 90 s.
- `server.js`: `/game/Build/*` served by `serveGameFile`: gzip once and kept in memory (50 → 19.4 MB over the wire), `Cache-Control: immutable`, `.wasm` MIME. The running server must be restarted to pick this up.
- `Scripts/Board/WebPageFriendly.cs` turns off `WebGLInput.captureAllKeyboardInput` by reflection (the type can't be referenced in this project); `Assets/link.xml` keeps it from being stripped (takes effect on the next build).
- Checked: build loads and renders in headless Edge (Unity's own `public/game/index.html` test page); the user confirmed the embed on the logged-in main page.
- Splash: `Scripts/Board/BoardPageSignal.cs` waits for `SplashScreen.isFinished`, then calls `BoardPageReady()` in `Plugins/WebGL/BoardBridge.jslib` → `window.BoardPage.ready()` on the page; the GIF loader hides then and the map fades in from black (1.4 s, `.board-fade`). Page fallback: 12 s after Unity is ready.

## Working notes
- Unity is driven through the **MCP for Unity** server (CoplayDev, `Game/BJKIT/.mcp.json`; package in `Packages/manifest.json`). Open a Claude chat in `Game/BJKIT` with the Unity editor open to get the `mcp__unityMCP__*` tools.
- Unity screenshots taken by the MCP land in `Game/BJKIT/Assets/Screenshots/` (safe to delete).
- `data/` is committed on purpose (whole camp moves between PCs). Never print student names or passwords into other services.
