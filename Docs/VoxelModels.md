# Voxel models

A model is a 3D grid in which each cell holds a color or is empty. Quaxel stores
models as `.qvox` text files, which can be written and changed in a text editor.

```text
qvox 1
size 3 2 2

color o F26B19
color d 7A2E08

# y = 0, the bottom layer. The first row of each layer is z = 0.
ooo
ddd

# y = 1
.o.
...
```

## Format

Lines are read in this order:

1. `qvox 1`, the format and its version.
2. `size <width> <height> <depth>`, along X, Y and Z. Each is 1 to 4096.
3. Any number of `color <symbol> <RRGGBB>` lines. A symbol is one or two
   printable ASCII characters other than `.` and `#`, and every symbol in a file
   has the same length. One character allows 92 colors and two allow 8464.
4. The grid: `height` layers of `depth` rows of `width` cells. Each cell is one
   symbol, with no spaces between cells. `.` is an empty cell, or `..` with
   two-character symbols. Layers run bottom to top. Within a layer, rows run from
   z = 0 and each row runs from x = 0.

Blank lines and lines starting with `#` are ignored anywhere, so layers can be
separated for reading. Either kind of line ending works.

A file is rejected if it has a row of the wrong length, an undefined symbol, or
too many or too few rows. The error names the line.

## Loading

```c++
int volume = QuaxelAssets.LoadVoxelModel(world, "Assets/Warrior.qvox")
if volume < 0 { return false }
world.AttachVoxels(node, volume)
```

Paths are relative to the working directory, or to one of its six nearest
parents, so a game finds its assets from its repository root or build directory.
One voxel is one unit in the node's local space, so set the node's `Scale` to
the world size of a cell. The volume is centered on the node.

Every load creates a new volume. To show one model many times, load it once
and attach the same volume to each node.

Files larger than about 100 MB load slowly and are better generated in code
until a compact format exists. Text stores every cell, including empty ones,
while a volume in memory stores only the occupied 8 x 8 x 8 bricks.

## Animation

A model can hold named clips. Each clip is a sequence of whole grids shown one
after another, and each grid sets how long it stays on screen.

```text
qvox 1
size 3 1 2

color o F26B19
color d 7A2E08

clip walk loop

frame 120
o.o
.d.

frame 80
.o.
d.d

clip attack once

frame 60
ooo
ddd
```

After the colors, a file can have:

- `clip <name> <loop|once>` starts a clip. A name is printable ASCII with no
  spaces, is case sensitive, and is unique in its file. A `loop` clip repeats. A
  `once` clip stops on its last frame.
- `frame <milliseconds>` starts a frame, which must be inside a clip. It is
  followed by the same layers and rows as a plain model, and lasts at least 1 ms.

Colors come before the first clip and are shared by every frame. Every frame has
the model's `size`. A clip needs at least one frame. The grid before the first
clip is optional. If it is there, `LoadVoxelModel` returns it as a still pose.
Without it, `LoadVoxelModel` returns the first frame of the first clip.

```c++
int animation = QuaxelAssets.LoadVoxelAnimation(world, "Assets/Warrior.qvox")
if animation < 0 { return false }
world.AttachAnimator(node, animation)
world.PlayClip(node, "walk")
```

`AttachAnimator` also attaches the first frame's voxels, so the node needs only
a transform to be visible. Each load creates a new animation. To show one model
many times, load it once and attach that animation to each node. Every node
keeps its own clip, frame and speed.

| Call | Effect |
| --- | --- |
| `PlayClip(node, "walk")` | Starts the clip from its first frame. Does nothing if that clip is already playing, so it is safe to call on every step. Returns false for an unknown clip. |
| `StopClip(node)` | Holds the current frame. The next `PlayClip` starts from the beginning. |
| `SetAnimationSpeed(node, 2.0)` | Scales playback time. Zero or less holds the current frame. |
| `GetAnimator(node)` | Returns a copy of the state, including `Playing`, `Clip` and `Frame`. |
| `CurrentClipName(node)` | Returns the name of the clip the node last played. |

The engine advances animators once per fixed step, before `FixedStep`. To go
back to another clip when a `once` clip ends, test for it in `FixedStep`:

```c++
QuaxelAnimator animator = world.GetAnimator(node)
if !animator.Playing { world.PlayClip(node, "idle") }
```

Every frame is a separate volume. Playback only changes which volume a node
shows, so it costs no voxel writes after a frame's first upload. A frame uploads
the first time it is shown. Frames count toward the Vulkan backend's limit of
4096 uploaded volumes, and a game that passes the limit stops with a rendering
failure.

## Sockets

A socket is a named position and rotation on a grid. Sockets let one model hold
another, such as a sword in a character's hand. Because each frame declares its
own sockets, the held item moves and turns with the hand, frame by frame.

```text
clip swing once

frame 120
socket hand_r 41 30 12  0 20 0
...rows...

frame 80
socket hand_r 43 33 12  0 70 15
...rows...
```

A `socket` line goes anywhere inside its grid:

```text
socket <name> <x> <y> <z> [<yaw> <pitch> <roll>]
```

- `x y z` are voxel coordinates. A whole number is the center of that cell, so
  41.5 is the boundary between cells 41 and 42. Values can be negative or outside
  the grid.
- Rotation is in degrees and defaults to none. Roll about Z applies first, then
  pitch about X, then yaw about Y, each by the right-hand rule. Yaw turns +Z
  toward +X, and pitch turns +Y toward +Z.
- A name is printable ASCII with no spaces and is unique within one grid.
- A static model can have sockets too, in its one grid. Sockets before the first
  clip need that grid to be present.

An item marks where it is held with a socket named `grip`:

```text
qvox 1
size 3 12 3
socket grip 1 2 1
...
```

```c++
int sword = world.CreateNode()
world.AttachVoxels(sword, swordVolume)
world.AttachToSocket(sword, player, "hand_r")
```

`AttachToSocket` makes the item a child of the holder and lines the item's `grip`
up with the socket, in both position and rotation. Without a `grip`, the item's
center goes on the socket. The item inherits the holder's position, facing and
scale. Keep its own `Scale` at 1 for voxels the same size as the holder's.
The call returns false if no frame the holder can show has that socket.

Details:

- An item is hidden, along with its children, on any frame that does not define
  its socket. A clip can leave out `hand_r` to put the sword away.
- The engine sets the item's `Position`, `Rotation` and `Facing` on every step.
  Any other parent change, such as `world.SetParent(sword, 0)`, ends the
  attachment and the item keeps its last local transform.
- `world.GetSocketMatrix(player, "hand_r", matrix)` gives a socket's world pose
  on the current frame, for hit checks or spawn points. Items can have sockets
  of their own, so `GetSocketMatrix(sword, "tip", matrix)` works too.
- A rotated volume's faces are shaded by that rotation. `Facing` does not change
  shading, so a character keeps its look as it turns.
- Each attached item is one more volume to trace per frame.
