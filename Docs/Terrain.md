# Terrain generation

The engine code is in `Source/Core/Terrain/`, and Hellfeather's modules are in its
`Source/Terrain.dk`. The results tables below come from a prototype of this
pipeline that ran before the Duck code existed.

A terrain is a seeded map of flat **clearings** joined by **passes**, set in
**mountains** that the player cannot enter. Each clearing is filled by a swappable
**module**, such as a plain valley, a valley with a house, or a river crossing.
Three properties hold for every seed and every module:

- Every clearing can be reached on foot.
- Anything the player cannot walk on looks like it.
- A mountain never hides walkable ground, apart from a short lip at its foot.

## One field decides everything

Noise alone gives no connectivity guarantee, and classifying slope after the
fact lets the visuals dictate gameplay. Instead, a single signed distance field
`d(x, z)` is built from the layout, and everything else derives from it:

| `d` | Meaning | Height |
| --- | --- | --- |
| `d < 0` | Open. The player can stand here. | Low-amplitude plains noise |
| `d >= 0` | Blocked. | Plains + lip + ramp + ridged noise |

Blocked and walkable therefore share one threshold. Collision, spawn placement
and the art all read the same answer.

## Pipeline

Each stage is a pure function of the seed and the position, so any chunk can be
built alone, in any order, on any machine.

**1. Layout graph.** Jitter sites on a lattice (44-unit spacing, 6 x 6 by
default). Each is active with 80% probability and gets a clearing of radius
10–18. A randomized Kruskal spanning tree over lattice neighbors picks the
passes, then a quarter of the leftover edges return as loops. Keep the largest
component. If it holds under 60% of the sites, advance a sub-seed and retry:
one of twelve prototype seeds kept only 12 of 36. The graph is also the map's
gameplay data, so spawns, objectives and encounters attach to its nodes.

**2. Routing.** The router assigns a module to every clearing, using each
module's rules. A module may enlarge its clearing here, so routing runs before
the field is built. See [Modules](#modules).

**3. Distance field.** Clearings are circles and passes are capsules, combined
with a polynomial smooth minimum. Only primitives near the chunk are evaluated.

```text
d(p) = smin(primitives)(p + shapeWarp(p) + detailWarp(p))
```

- `shapeWarp` is low frequency (±10 units, wavelength about 70). It stays
  one-to-one, which bends the layout without changing its topology.
- `detailWarp` is high frequency, and each axis is bounded by ±1.5, so the
  displacement is at most `A = 1.5 * sqrt(2) = 2.12`.

**Why passes stay open.** A point at distance `s` from a pass centerline has
`d <= s - r + A`, because a smooth minimum only lowers the field. Everything
within `r - A` of the centerline is open. Passes need `r - A` to exceed the
player's radius, so `r >= 3.5` leaves 1.38 units of clearance for a 0.5 radius.

**4. Height.** Work in integer voxel cells (1/8 unit).

```text
floor  = round(16 + 8 * fbm(p / 28))                   // +-1 unit, signed fbm
open   : height = floor
blocked: height = floor + lip + ramp(d) * 40 + ridged(p) * saturate(d / 5) * 24
```

`lip` is 6 cells, so even the first blocked column visibly reads as a wall.

**5. Modules and reserved paths.** Each clearing's module edits its own columns
and requests placements. The generator then re-opens the reserved paths. See
[Modules](#modules).

**6. View ceiling.** See below. This is the step that makes tall terrain work
with the isometric camera.

**7. Color.** Each column has a surface ID, and the game overrides `SurfaceColor`
to choose a color from a `QuaxelTerrainCell`: surface, world position, height, a
per-cell hash, and how close the column is to a mountain's foot. The renderer
treats colors as linear and shades top, X and Z faces separately. Three config
values shape the ground: `RoadWidth` lays a road along each pass,
`GroundRoughness` adds small bumps, and `TerraceStep` snaps cliffs into tiers.

**8. Voxel shell.** Rays only arrive from +X +Y +Z, so a cell is visible only if
its top, +X or +Z neighbor is empty. Fill each column from
`min(min(h[x+1,z], h[x,z+1]) + 1, h)` up to `h`. Everything else is never hit.

## The view ceiling

Hellfeather's camera sits at equal X, Y and Z offsets, so a view ray moves exactly
one cell on each axis per step. Column `(x, z)` hides the floor of
`(x-k, z-k)` exactly when `h[x,z] - k > h[x-k, z-k]`. That makes the fix one
integer pass along the diagonals:

```text
ceiling[x,z] = mountain[x,z] ? ceiling[x-1,z-1] + 1 : floor[x,z] + lip
height[x,z]  = mountain[x,z] ? min(raw[x,z], ceiling[x,z]) : raw[x,z]
```

Every non-mountain column resets the ceiling, so rivers stay visible as well as
walkable ground.

Faces toward the camera, whose open ground lies on the +X/+Z side, have no
ceiling pressure and stay as tall cliffs. Only slopes that would cover ground
behind them are pulled down. Those slopes are nearly edge-on from this camera,
so the height loss barely shows.

The rule relies on the fixed camera, as does the shell in stage 8. A rotating
camera would need the porthole described under risks, and a solid fill.

## Modules

The base module holds the rules and the default behavior, which is a plain green
valley. A variant overrides only what differs. The generator never knows which
module it is running, so adding one requires no generator changes.

```text
Base module (rules, defaults) -> Router (picks one per clearing) -> Generator
```

```duck
// Engine. The defaults produce a plain valley.
QuaxelTerrainModule
{
    // Rules the router checks before giving this module a clearing.
    QuaxelTerrainModuleRules Rules() { return QuaxelTerrainModuleRules.Default() }

    // Edits one column of this clearing. X and Z are layout-space offsets.
    Column(QuaxelTerrainSite site, float x, float z, QuaxelTerrainColumn& column) {}

    // Requests voxel models, once per clearing.
    Place(QuaxelTerrainSite site, QuaxelTerrainPlacer& placer) {}
}

// Game. Only the river-specific part is written.
RiverCrossing : QuaxelTerrainModule
{
    Column(QuaxelTerrainSite site, float x, float z, QuaxelTerrainColumn& column)
    {
        if Math.Abs(AcrossRiver(site, x, z)) < 2.0 { column.MakeWater(5) }
    }
}
```

`QuaxelTerrainModuleRules` is plain data: minimum radius, minimum and maximum
ports, whether the clearing must not touch another, the share of clearings
wanted, and the maximum count. Later this can also hold distance from the start.

**The router.** The game derives from `QuaxelTerrain` and holds its modules as
fields:

```duck
HellfeatherTerrain : QuaxelTerrain
{
    QuaxelTerrainModule Valley    // ID 0 is the fallback
    RiverCrossing River
    ValleyHouse House

    int ModuleCount() { return 3 }

    ModuleColumn(int id, QuaxelTerrainSite site, float x, float z, QuaxelTerrainColumn& column)
    {
        if id == 1 { River.Column(site, x, z, column) }
        else if id == 2 { House.Column(site, x, z, column) }
        else { Valley.Column(site, x, z, column) }
    }
    // ModuleRules and ModulePlace forward the same way.
}
```

Routing visits clearings in seeded order and gives each to the first module that
still wants one and whose rules it meets. A clearing nothing claims stays module
0. The spawn clearing, which is the largest, uses `SpawnModule()`, which defaults
to 0. Changing the default clearing means changing that one field.

The ID dispatch is deliberate. Duck rejects converting `Cat*` to `Animal*`, and
rejects passing a field by reference ("cannot expose tracked heap storage by
reference"). Calling a method on a field works, and calls on `this` inside
`QuaxelTerrain` reach the game's overrides.

**What a module may do.** It receives one column at a time and may change its
height offset and surface, or mark it as water or blocked. It sees layout-space
coordinates, so a straight river line picks up the warp and follows the terrain.
It must be a pure function of `site` and position, and must take randomness only
from `site.Seed`. That keeps chunks independent.

**What the generator enforces.** These rules are why a module cannot break a map:

| Rule | Mechanism |
| --- | --- |
| Clearings stay connected | Columns within 2 units of a pass centerline are re-opened after modules run |
| A river always has a crossing | Water on a reserved path becomes the bridge surface at floor height |
| Modules stay in their clearing | The column callback only runs on open ground the site owns |
| Nothing hides walkable ground | Placements must keep their sight strip clear, see below |

The river module never mentions a bridge. It paints water, and the reserved path
produces the crossing wherever the two meet. The river must separate the two
ports farthest apart, otherwise one bank is unreachable.

**Placements** are for things a height column cannot represent, such as a house
with a door or overhang. A module calls one of these for each position it would
accept, in order of preference:

- `placer.Offer(group, volume, x, z, half, height)` for a building made of
  terrain-sized voxels.
- `placer.OfferBuilding(group, volume, x, z, half, height, sight, voxelSize)` for
  a building with finer voxels. `sight` is the height used for its sight strip,
  so one slim tower does not clear a huge area behind the building.
- `placer.OfferProp(group, volume, x, z, half, height, voxelSize)` for a tree,
  rock or banner. A prop blocks only its footprint and has no sight strip.

`placer.AddLight(offsetX, offsetZ, radius)` bakes warm firelight into the ground
around the latest offer. For each group, the generator takes the first offer
that passes these steps. Props skip steps 4 and 5, and models in one clearing
keep clear of each other:

1. Convert the layout point to a world position with a fixed-point inverse of
   the warp, 16 iterations.
2. Keep the footprint rigid in world space so it matches the model.
3. Refuse if the footprint is not open ground, if the footprint comes within 1
   unit of a reserved path, or if the sight strip touches one.
4. Block the footprint and flatten it to the anchor's floor height.
5. Block the **sight strip**, the columns toward -X -Z the model would hide, and
   give it a low yard surface. Height `H` needs `H - lip + 2` diagonal cells.

If every offer is refused the clearing stays a plain valley, which happened for
2 of 77 houses in the prototype. Placements are resolved once at startup. The
volume is created once and shared, and each instance is a node created and
destroyed with the chunk at its anchor.

Passes keep default terrain for now. They can accept modules later through the
same interface, with a capsule instead of a circle. A river spanning the whole
map needs a map-level layer and is out of scope here.

## Chunks

One volume cannot hold a useful map. A flat 256 x 256 unit plain at 1/8-unit
cells touches 65,536 bricks at about 2 KiB each, which alone reaches the 128 MiB
per-buffer limit. Terrain is therefore split into chunks.

- A chunk is 16 x 16 units, or 128 x 128 columns, 128 cells tall: one node and
  one volume.
- The resident set is 5 x 5 chunks centered on the player. At most about 26 units
  are visible from the player, counting tall terrain, and this set covers at least 32.
- Beyond the lattice, `d` stays positive, so the world is ringed by endless
  mountains. The map needs no separate edge clamp and never shows the void.
- Chunk nodes come from a fixed pool of 25, which are retargeted rather than
  created. The world can destroy nodes but cannot release a volume.
- At 4 units per second, crossing a chunk takes 4 seconds and needs 5 new chunks.
  `Stream` spends a column budget each fixed step, then uploads the finished chunk.
- The warp and floor are sampled every 4 columns and interpolated, which keeps a
  chunk's noise cost low. Mountain ridges are sampled per column.

Building a chunk evaluates the field on a grid padded 80 columns toward -X -Z
for the ceiling sweep, and by 1 toward +X +Z for the shell. The padding makes
results independent of build order, so neighboring chunks agree at their seams.

## Collision and movement

`QuaxelTerrain` keeps one height and one open bit per column for each resident
chunk. Both are independent of the GPU, so headless builds and tests get the
same terrain.

- `MoveCircle(position, delta, radius)` moves X and Z separately and rejects an
  axis if any column inside the circle is blocked, so the player slides along
  walls. At 4 units per second a step is under one cell, which rules out tunneling.
- `GroundY(position)` is the bilinear height at the feet, with a short smoothing
  lag. Adjacent open columns never differ by more than one cell, so no step limit
  is needed.
- Unbuilt ground counts as blocked, so nothing walks onto a chunk before it exists.
- The largest clearing sits at the world origin, with its floor at height 0.
- Spawns must use a clearing center from the layout graph, never a random open
  column. Warp can pinch off rare tiny open pockets (at most 0.0003% of open
  area in the prototype).

## Engine and game boundary

| Quaxel (`Source/Core/Terrain/`) | Hellfeather |
| --- | --- |
| `QuaxelNoise`: seeded value noise and fbm | Seed |
| `QuaxelTerrainConfig`: every tunable below | Config values and palette |
| `QuaxelTerrainModule`: base module | Module variants |
| `QuaxelTerrainLayout`: graph | Models and gameplay at each clearing |
| `QuaxelTerrain`: routing, field, reserved paths, chunks, queries, streaming, `MoveCircle` | `HellfeatherTerrain`, and calling `Stream`, `MoveCircle` and `GroundY` from `FixedStep` |

Outside the terrain code, the engine gains `QuaxelWorld.ResetVolume(index)`,
which reuses a volume slot and marks it dirty. No shader or renderer changes were
required.

## Parameters

| Name | Default | Unit | Effect |
| --- | --- | --- | --- |
| `SiteSpacing` | 44 | units | Distance between clearings |
| `SiteGrid` | 6 x 6 | sites | Map size, 264 units or 66 seconds in a straight line |
| `ActiveChance` | 0.8 | | Lower means more mountain mass |
| `ClearingRadius` | 10–18 | units | Size of open areas |
| `PassRadius` | 3.5–5.5 | units | Must satisfy `r - A > playerRadius` |
| `LoopFraction` | 0.25 | | Share of spare edges kept as loops |
| `DetailWarp` | 1.5 | units | Per axis, sets `A` |
| `ShapeWarp` | 10 | units | Keep the warp's slope below 1 |
| `PlainsAmplitude` | 8 | cells | How flat "somewhat flat" is |
| `Lip` | 6 | cells | Minimum wall height, and the floor it may hide |
| `Peak`, `Ridge` | 40, 24 | cells | Mountain height |
| `RampWidth` | 5 | units | How fast walls rise |

## Prototype results

Twelve seeds at full resolution with the defaults above:

| Check | Result |
| --- | --- |
| All clearings connected for a 0.5-radius player | 12 of 12 |
| Largest step between adjacent open columns | 1 cell |
| Open floor hidden, no ceiling (above lip height) | 12.5% average |
| Open floor hidden, with ceiling (above lip height) | 0% |
| Open floor hidden at its lowest cell, with ceiling | 4.6% worst, the strip behind a lip |
| Worst chunk | 1.15 MiB, 21,290 voxels |
| Worst resident set, 25 chunks | about 29 MiB |

With modules, on the same twelve seeds (168 valleys, 77 rivers, 77 houses; the
house was a placeholder box):

| Check | Result |
| --- | --- |
| Maps with every port reachable | 12 of 12 |
| Same maps with reserved paths switched off | 0 of 12 |
| Open floor hidden above lip height | 0% |
| Largest share of open ground unreachable | 0.04% |
| Houses placed | 75 of 77 |
| Worst warp inverse residual | 0.0002 units |

## Risks to measure in the engine

- **Dispatch count.** Each visible chunk is one compute dispatch and barrier,
  against 3 volumes today (ground, warrior, axe). Expect 9 to 16. Sorting near to far would
  let the shared depth buffer end rays sooner.
- **Upload stalls.** `MapVolume` waits on the frame fence and reallocates when
  replacing a volume. If that hitches, keep per-chunk buffers at a fixed capacity.
- **Build time.** Prototype timing does not transfer to Duck. The column budget
  needs tuning, and a build-time cost may justify a worker thread later.
- **Seams.** Rays stop at volume bounds, so chunk edges could crack. If they do,
  extend each chunk by one overlapping column.
- **Enemy occlusion and terrain shape.** The ceiling protects floors, so a
  character near a lip loses only its feet. Clearings still read as chained
  circles at map scale; ellipses and wider radius variance are the first tuning pass.

If the camera ever rotates, keep the column data but replace the ceiling with a
screen-space porthole in `Voxel.comp`: skip voxels closer than the player inside
a screen circle. The push constants have room (100 of 128 guaranteed bytes used).

