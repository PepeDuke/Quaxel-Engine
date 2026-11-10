# Quaxel Engine

A game engine written in Duck. This repository owns reusable engine code;
[Hellfeather](../Hellfeather) owns the game and executable entry point.

## Build

Keep the repositories as siblings (or update the game project reference):

```text
Projects/
  Duck/             compiler and build tool
  Quaxel-Engine/    Quaxel.dkp, Source/Core/
  Hellfeather/      Hellfeather.dkp, Source/Main.dk
```

From this directory, `./build.ps1` builds engine objects only.
Use `./build.ps1 -Profile release` for optimization, or `-DuckRoot <path>`
for another Duck checkout. `-Platform headless` and `-Platform windows` build
core plus the shared platform API and selected backend; the default `core` builds
only the portable core. Duck's build tool must first be compiled with
`cmake -S <Duck> -B <Duck>/build` and `cmake --build <Duck>/build --config Debug`.
Clang and the Windows C++ toolchain are also required by the bootstrap.

From Hellfeather, `./build.ps1` compiles both projects and links Hellfeather.exe.
The default game manifest references `../Quaxel-Engine/Quaxel.Headless.dkp`;
`Hellfeather.Windows.dkp` references `Quaxel.Windows.dkp`. Both consume
`quaxel_core` and `quaxel_platform`, with identical game source. Engine sources are not copied into the game.
Game build artifacts belong to the game's `.duck/build/<profile>` directory;
standalone engine artifacts belong to this repository's corresponding directory.
Windows outputs use `.duck/build/windows/<profile>`; headless engine outputs use
`.duck/build/headless/<profile>`. The default headless game retains
`.duck/build/<profile>`. Backend outputs cannot overwrite one another.

## Current foundation

`Quaxel.dkp` is a library project without `Main`. `Source/Core/Runtime.dk`
provides a version query, a fixed simulation step, and a caller-owned
`QuaxelSession`. A session starts stopped at frame zero. `Begin()` starts or
restarts it, `Advance()` increments the frame while running, and `Stop()` keeps
the last frame available. Games can read the `Frame` and `Running` properties.
The static `Quaxel` functions still accept separately stored frame and running
values.
All engine runtime and game source is Duck; PowerShell is only a build launcher.
The Duck bootstrap compiler and build tool are currently implemented in C++.

`quaxel_engine` (`Source/Engine`) owns the main loop. A game derives from
`QuaxelGameInstance` and passes itself to `QuaxelEngine.Run`, which handles
startup, message pumping, fixed updates, rendering and teardown. Core also
provides vector and matrix math, worlds, nodes and components, input snapshots,
and reusable plane and cube geometry.

The x64 Windows backend provides a performance clock, held-key state and one
resizable main window. Its Vulkan compute shader renders the active world by casting orthographic
rays through sparse voxel volumes. Empty 8×8×8 bricks are skipped in one
step. Occupied bricks use incremental Amanatides–Woo grid traversal. In a 960 x 540
client area, Hellfeather shows a cube on a plane that WASD moves. The headless
build runs three fixed simulation steps with neutral input and no GPU.

Windows builds require the x64 Vulkan SDK. The Windows build launchers stage
its import library automatically. Before calling Duck directly on a fresh
checkout, run `./configure-vulkan.ps1`. The executable uses the graphics
driver's Vulkan runtime. Shader bytecode is embedded in the Windows module.
After editing the GLSL in `Shaders/`, run `./Shaders/compile.ps1` with
`VULKAN_SDK` set, then rebuild.

The gameplay architecture uses an engine-owned main loop, a persistent game
instance, and worlds composed of nodes and components.
[World and ECS design](Docs/World.md)

Games build their interface with Duck markup. The engine lays it out and draws
it over the world. [User interface](Docs/Ui.md)

Models are 3D color grids stored as editable text files, and can hold named
animation clips and per-frame attachment sockets.
[Voxel models](Docs/VoxelModels.md)

Effects such as blood, smoke and fire are animated voxel particles that collide
with the world's voxels, so blood stains whatever it lands on. [Effects](Docs/Effects.md)

Worlds can be generated as seeded maps of clearings, passes and mountains, with
each clearing filled by a swappable module. [Terrain generation](Docs/Terrain.md)

## Dependency boundary

Dependency direction is `Hellfeather -> Quaxel`; Quaxel must not import game code.
New engine modules belong in this manifest. Games select their public services
through explicit module dependencies. Duck currently exposes all functions in a
shared symbol namespace, so engine APIs use the `Quaxel` static container.
Project references build separate objects from source and link them together;
prebuilt SDK distribution, DLL plugins and incremental builds are not yet supported.


## Platform abstraction

Core contains no Windows code. `Source/Platform/Api` is shared by all platforms;
`Source/Platform/Windows` owns Win32 imports and `Source/Platform/Headless` is the
portable fallback. A future Linux implementation plugs into the same build-time
contract. See [platform architecture](Docs/Platform.md) for module boundaries,
window API requirements, text encodings and backend implementation rules.

Duck `string` is always UTF-16; Duck `name` is UTF-8. Native encoding conversion
belongs in the backend. Neither type is the bootstrap's native `cstring`.

```powershell
./build.ps1 -Platform core
./build.ps1 -Platform windows -Profile release
../Duck/duck.cmd test Quaxel.Headless.dkp
../Duck/duck.cmd test Quaxel.Windows.dkp
../Duck/duck.cmd test Tests/Mock.dkp
```
