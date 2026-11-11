# Effects

Effects such as blood, smoke and fire are made of voxels, like everything else
in a world. They run on the GPU. The CPU records how an effect starts and when
it stops, and the GPU does everything else:

- moving the particles,
- colliding them with the world's voxels,
- leaving stains,
- drawing them into a voxel volume that the renderer traces like any other.

```duck
// Blood from a hit. The wounded node does not stop its own blood.
world.StartEffectIgnoring(QuaxelEffectStyle.BloodSplatter(), hitPoint, hitDirection + vec3(0.0, 1.0, 0.0), enemyNode)

// A campfire: flames and smoke from the same point until it is put out.
int flames = world.StartEffect(QuaxelEffectStyle.Fire(), groundPoint, vec3(0.0, 1.0, 0.0))
int smoke = world.StartEffect(QuaxelEffectStyle.Smoke(), groundPoint + vec3(0.0, 0.3, 0.0), vec3(0.0, 1.0, 0.0))
world.StopEffect(flames)
```

## Calls

| Call | Effect |
| --- | --- |
| `StartEffect(style, origin, direction)` | Starts an effect and returns its ID. Returns 0 if the style is invalid or 64 effects are already playing. `direction` aims the particles. |
| `StartEffectIgnoring(style, origin, direction, node)` | The same, but the node and its descendants let the particles through. |
| `StopEffect(id)` | Stops emitting. Particles and stains already out play to their end. |
| `EndEffect(id)` | Removes the effect at once, stains included. |
| `IsEffectPlaying(id)` | True until the effect has nothing left to show. |
| `PlayingEffectCount()` | How many effects are playing. |
| `SetCatchesEffects(node, false)` | Particles pass through the node and its descendants. |
| `IsSolidAt(point)` | True if a voxel of a node that catches effects covers the point. |

An ID is never reused. Calls with the ID of an ended effect do nothing and
return false.

The CPU never sees the particles, so how long an effect plays is worked out
from its style:

- A burst plays for `LifeMax` seconds after it starts.
- An emitter plays for `LifeMax` seconds after it stops.
- An effect that leaves stains (`Stick`) plays `StainSeconds` longer.

## Slots and pages

Every effect has a fixed 64 × 64 × 64-cell grid, called a **slot**. A slot
lives in a **page**, which is a persistent storage buffer of 8 slots on the
GPU, about 9 MB.

- **Pages grow as needed.** The first page is made with the first effect. When
  every slot is busy, another page of the same size is added, up to 8 pages
  (64 effects). Pages are kept until the world is released.
- **Slots are reused.** A new effect takes a free slot before a new page is
  added.

A slot holds, in order:

1. **Its volume.** This uses the same brick format as any volume, with each of
   its 512 bricks at a fixed place. The GPU rebuilds the brick directory every
   frame, so empty bricks are skipped while tracing.
2. **A solid mask.** One bit per cell, marking the world voxels it covers.
3. **Up to 1024 particles.**
4. **The effect's params.** These are the style, origin, direction, seed and
   stop step, as `QuaxelEffectParams`.

The layout is defined three times, and the three must agree:

- `Shaders/EffectCommon.glsl`
- `QuaxelVulkan` in `Source/Platform/Windows/Vulkan/Effects.dk`
- `QuaxelEffectParams` in `Source/Core/Effects.dk`

## Each frame

`QuaxelEngine.Render` records this work for each playing effect, before
tracing the world:

1. **Reset and bake.** These run once, on the effect's first frame. The slot is
   emptied and its params are written. Each visible volume that overlaps the
   grid and catches effects is then baked into the solid mask
   (`EffectBake.comp`).
2. **Simulate.** `EffectSim.comp` runs once for every fixed step since the last
   frame, at most 10.
   - **Particles are born from their index and the step.** No spawn data is
     uploaded.
   - **Forces:** gravity, drag and wander.
   - **Movement** is tested against the solid mask in half-cell steps.
   - **On contact**, a particle dies, bounces, slides, or sticks as a stain.
3. **Draw.** Three passes redraw the volume:
   - `EffectClear.comp` empties the bricks that were drawn into last frame.
   - `EffectStamp.comp` draws flying particles as dithered balls with trails,
     and stuck ones as stains lying on the face they hit.
   - `EffectBricks.comp` rebuilds the directory.
4. **Trace.** After the world's volumes, each slot is traced with the ordinary
   voxel shader, starting at the slot's first word. The shared depth buffer
   orders effects against everything else.

Effects advance in fixed steps, so they look the same at any frame rate. The
CPU work per effect per step is a counter.

## Collisions and stains

The solid mask is baked **once**, when the effect starts. These are ignored
afterwards:

- terrain that streams in later,
- props that move later,
- things spawned later.

Effects are short, so this is rarely visible.

A stain is a ragged patch, one voxel thick, lying on the face the drop hit:
the top of the ground or the side of a wall.

- **Size and shape:** faster drops leave wider patches, stretched in the
  direction they were moving.
- **Edges:** a stain cell is drawn only where the mask has solid voxels behind
  it. So stains end at ledges, and they climb onto small rises.
- **Shared volumes are never changed.** Stains are part of the effect, so a
  volume used by many nodes, such as one tree model, is never stained.

Every node with voxels catches effects by default. Call
`SetCatchesEffects(node, false)` for things that move, such as creatures,
because a stain stays where it landed. A node hidden by its socket catches
nothing.

## Styles

`QuaxelEffectStyle` holds everything that sets an effect's look. The presets are
`BloodSplash`, `BloodSplatter`, `Fire`, `Smoke`, `Dust` and `Sparks`. Change a
preset's fields for a variation:

```duck
QuaxelEffectStyle poison = QuaxelEffectStyle.BloodSplash()
poison.ColorStart = 0x6cc030
poison.ColorMiddle = 0x4a9a20
poison.ColorEnd = 0x2e6a14
poison.StainColor = 0x3e7a18
poison.StainDryColor = 0x24400c
```

| Fields | Meaning |
| --- | --- |
| `VoxelSize`, `Floor` | The world size of a cell, which also sets the effect's reach: 64 cells across. X and Z are centered on the origin. `Floor` places the origin in the height, from 0 at the bottom to 1 at the top. A particle that leaves the grid ends. |
| `MaxParticles` | Particle slots, at most 1024. A burst uses the first ones. An emitter reuses the rest in turn, and skips any that are still in use. |
| `Burst`, `Rate`, `EmitSeconds` | Particles released at the start, then per second for `EmitSeconds`. A negative `EmitSeconds` emits until `StopEffect`. |
| `SpawnRadius`, `SpawnFlat` | Particles start in a ball of this radius around the origin, or in a level disc. |
| `SpeedMin`, `SpeedMax`, `Spread` | Launch speed, and the cone around the direction in degrees. 180 is every direction. |
| `Gravity`, `Drag`, `Wander` | Vertical acceleration (positive rises), fraction of speed lost per second, and a random horizontal push. |
| `LifeMin`, `LifeMax` | A particle's lifetime in seconds. |
| `SizeStart`, `SizeEnd` | Radius in voxels over a particle's life. Below 0.5 is a single voxel. |
| `DensityStart`, `DensityEnd` | The share of a particle's voxels that are drawn. Voxels are opaque, so lower values stipple it, which reads as thin smoke. |
| `ColorStart`, `ColorMiddle`, `ColorEnd`, `MiddleAt` | Color over a particle's life. |
| `Shade`, `Flicker` | Random brightness per voxel. `Flicker` chooses new voxels every step, as flames do. |
| `Streak` | Trailing voxels per unit of speed, behind fast drops and sparks. |
| `Contact` | What a particle does when it reaches a solid voxel: `Pass`, `Die`, `Stick`, `Bounce` or `Slide`. |
| `Bounciness` | For `Bounce`, the share of speed into the surface that is kept. |
| `StainRadius`, `StainSeconds`, `StainColor`, `StainDryColor` | Stains left by `Stick`. They dry over the first half of `StainSeconds`, thin out after 60%, and are gone at the end. |

## Headless

Headless builds have no GPU. Effects there keep their bookkeeping: IDs, slots
and end times all behave the same, but nothing is simulated or drawn. The
physics is tested by reading slots back from the GPU in `Tests/EffectGpu.dk`,
which is part of the Windows test project.
