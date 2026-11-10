# Effects

Effects such as blood, smoke and fire are made of voxels, like everything else
in a world. Each effect simulates particles in world space and redraws them into
a volume of its own on every fixed step, so effects use the ordinary voxel
renderer. Particles can hit the voxels of other volumes. That is how blood stains
the ground and smoke spreads under a ceiling.

```duck
// Blood from a hit. The wounded node does not stop its own blood.
world.StartEffectIgnoring(QuaxelEffectStyle.BloodSplatter(), hitPoint, hitDirection + vec3(0.0, 1.0, 0.0), enemyNode)

// A campfire: flames and smoke from the same point until it is put out.
int flames = world.StartEffect(QuaxelEffectStyle.Fire(), groundPoint, vec3(0.0, 1.0, 0.0))
int smoke = world.StartEffect(QuaxelEffectStyle.Smoke(), groundPoint + vec3(0.0, 0.3, 0.0), vec3(0.0, 1.0, 0.0))
world.StopEffect(flames)
```

The engine advances effects once per fixed step, after the game's `FixedStep`,
so an effect started during a step is drawn on that step.

## Calls

| Call | Effect |
| --- | --- |
| `StartEffect(style, origin, direction)` | Starts an effect and returns its ID, or 0 if the style is invalid or 64 effects are playing. `direction` aims the particles. |
| `StartEffectIgnoring(style, origin, direction, node)` | The same, but the node and its descendants let the particles through. |
| `StopEffect(id)` | Stops emitting. Particles and stains already out play to their end. |
| `EndEffect(id)` | Removes the effect at once, stains included. |
| `IsEffectPlaying(id)` | True until the effect has nothing left to show. |
| `SetCatchesEffects(node, false)` | Particles pass through the node and its descendants. |
| `IsSolidAt(point)` | True if a voxel of a node that catches effects covers the point. |

An ID is never reused, so calls with the ID of an ended effect do nothing and
return false. When an effect ends, its node and volume go back to a pool for the
next effect.

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
| `Width`, `Height`, `Depth`, `VoxelSize`, `Floor` | The effect's grid, in cells, and the world size of a cell. X and Z are centered on the origin and `Floor` places the origin in the height, from 0 at the bottom to 1 at the top. A particle that leaves the grid ends. |
| `Burst`, `Rate`, `EmitSeconds` | Particles released at the start, then per second for `EmitSeconds`. A negative `EmitSeconds` emits until `StopEffect`. |
| `SpawnRadius`, `SpawnFlat` | Particles start in a ball of this radius around the origin, or in a level disc. |
| `SpeedMin`, `SpeedMax`, `Spread` | Launch speed, and the cone around the direction in degrees. 180 is every direction. |
| `Gravity`, `Drag`, `Wander` | Vertical acceleration (positive rises), fraction of speed lost per second, and a random horizontal push. |
| `LifeMin`, `LifeMax` | A particle's lifetime in seconds. |
| `SizeStart`, `SizeEnd` | Radius in voxels over a particle's life. Below 0.5 is a single voxel. |
| `DensityStart`, `DensityEnd` | The share of a particle's voxels that are drawn. Lower values stipple it, which reads as thin smoke, since voxels are opaque. |
| `ColorStart`, `ColorMiddle`, `ColorEnd`, `MiddleAt` | Color over a particle's life. |
| `Shade`, `Flicker` | Random brightness per voxel. `Flicker` chooses new voxels every step, as flames do. |
| `Streak` | Trailing voxels per unit of speed, behind fast drops and sparks. |
| `Contact` | What a particle does when it reaches a solid voxel. See below. |
| `StainRadius`, `StainSeconds`, `StainColor`, `StainDryColor` | Stains left by `Stick`. They dry over the first half of `StainSeconds`, thin out after 60% and are gone at the end. |

## Contact with other voxels

| `Contact` | Result |
| --- | --- |
| `Pass` | Particles ignore other volumes. This is the cheapest. |
| `Die` | The particle vanishes. |
| `Stick` | The particle ends and leaves a stain on the surface it hit. |
| `Bounce` | The particle rebounds, keeping `Bounciness` of its speed into the surface. |
| `Slide` | The particle loses its speed into the surface and keeps moving along it. |

A stain is a ragged patch one voxel thick, lying on the face that the drop hit:
the top of the ground, or the side of a wall. Faster drops leave wider patches,
stretched in the direction they were moving. A stain cell is drawn only where it
has a solid voxel behind it, so stains end at ledges instead of hanging in the
air, and climb onto small rises. Stains are part of the effect, so they never
change the volume they lie on. That volume can be shared by many nodes.

Every node with voxels catches effects by default. Call
`SetCatchesEffects(node, false)` for things that move, such as creatures, since a
stain stays where it landed. Effect nodes never catch other effects. A node
hidden by its socket catches nothing.

## Cost

- Each playing effect reuploads its volume on every rendered frame, and each
  is one more volume to trace. Up to 64 effects can play at once.
- `Pass` effects do no collision work. Other effects list the voxel nodes near
  them each step and test each moving particle against those volumes along its
  path. A few hundred particles per effect are fine.
- Stains cost nothing to simulate. They are redrawn with the particles.
