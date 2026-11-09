# Worlds, nodes, and components

Quaxel's gameplay foundation is an entity component system (ECS). The engine
owns the lifecycle, from starting the main loop to releasing the last world.
The game supplies the initial world, component types, and gameplay systems.
`QuaxelEngine.Run` implements the lifecycle below for one world. Moving between
worlds is not implemented yet.

```text
Engine main loop
└── Game instance
    └── Active world
        └── Player node
            ├── Transform component
            ├── Health component
            └── Lantern node
                ├── Transform component
                └── Light component
```

## Composition

Every object placed in a world is a **node**, the ECS entity. A world can have
many root nodes. Each node belongs to one world, has at most one parent, and
can have both child nodes and components. Use a child when something needs
its own identity or attachments. Use a component to give an existing node a
capability. In the example, damage targets the player's Health component.
Detaching the lantern moves its light and transform together.

A **system** operates on nodes with a matching set of components. A lighting
system can query every node with Light and Transform, whether the light hangs
from a player or stands alone in the world. The parent-child tree expresses
ownership. The engine schedules the systems that update those nodes.

## Current implementation

`QuaxelWorld` gives each node an ID local to that world. IDs start at 1 and
are not reused, so 0 always means "no node". Engine components are stored on
the node: `QuaxelTransform`, `QuaxelMeshRenderer`, `QuaxelCamera` and
`QuaxelAnimator`, which plays [voxel clips](VoxelModels.md#animation). `NextWith`
walks the active nodes that have a set of components. A camera looks along a
fixed direction from its node's world position, so attaching it as a child
makes it follow the parent.

A game overrides `QuaxelGameInstance` to build its starting world in `Prepare`
and advance it in `FixedStep`. Game-defined component types are stored by the
game and keyed by node ID. In Hellfeather, `PlayerController` works this way.

## Voxel geometry

A volume is a grid centered on its node. Each cell is one local unit wide
before the node and parent transforms are applied. Volumes can be shared by
several nodes. For example, this creates one colored cell in a 128³ grid.

```duck
int terrain = world.CreateVolume(128, 128, 128)
world.SetVoxel(terrain, 64, 64, 64, 0x549840)
int node = world.CreateNode()
world.AttachTransform(node, QuaxelTransform.Make(
    vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0)))
world.AttachVoxels(node, terrain)
```

GPU payloads follow Z-order (Morton order) across occupied bricks and within
each 8×8×8 brick. The X, Y and Z bits occupy positions 3i, 3i+1 and 3i+2.
A dense brick directory maps coordinates to offsets so an empty brick costs
one word. Rectangular volumes require no power-of-two padding in that directory.

Pass a negative color to erase a cell. A zero color creates an opaque black
voxel. A changed volume uploads on the next rendered frame. Moving a node
reuses its GPU data. The built-in cube and plane constructors supply a solid
voxel and a thin ground slab respectively. Custom world geometry uses the
volume API.

## Lifecycle

1. **Start.** The game's entry point hands control to the engine. The engine
   creates a game instance, prepares its initial world, and activates the world
   once its nodes, components, and systems are ready.
2. **Run.** The engine pumps platform events, advances the active world's
   systems on fixed simulation steps, and presents a frame when rendering is
   enabled. Systems can request changes during a step. The world applies
   additions and removals between steps so a query stays valid while it runs.
3. **Stop.** The engine stops scheduling the world, releases its nodes and
   components, then releases the game instance. Removing a node also removes
   the components and descendants it still owns.

## Moving between worlds

The initial design assumes one active world per game instance. For example,
entering a dungeon requests a transition from the town world. The engine
prepares the dungeon while the town is still valid, switches worlds between
simulation steps, then releases the town. If preparation fails, the town stays
active.

The game instance survives the switch and owns state that should travel, such
as player progression. The dungeon can use that state to create its player
node at the entrance. Node references are local to their world and expire
when that world is released.
