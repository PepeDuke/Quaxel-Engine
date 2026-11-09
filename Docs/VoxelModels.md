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
