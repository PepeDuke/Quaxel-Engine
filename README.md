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
step. Occupied bricks use incremental Amanatides–Woo grid traversal over
per-cell occupancy bits, jumping over empty 2×2×2 and 4×4×4 blocks. A
lighting pass then adds sunlight with voxel shadows, sky light and ambient
occlusion. In a 960 x 540
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

Saves, settings and caches can be written as JSON, packed with gzip and read
back, all in Duck with no native library. [Data: bytes, files, gzip and JSON](Docs/Data.md)

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

## Audio

Load a 16-bit PCM WAV once per world and reuse its clip handle. Mono and stereo clips are resampled to the 48 kHz output rate. Games can also supply interleaved signed samples with `world.AddSound(clip)`.

```duck
int step = world.LoadSound("Assets/footstep.wav")
QuaxelAudioSource source
source.InnerRadius = 1.0
source.OuterRadius = 16.0
world.SetAudioSource(footNode, source)
long first = world.PlaySound(step, footNode, 0.8, false)
long second = world.PlaySound(step, footNode, 0.8, false)
world.StopSound(first)
```

The source node needs a transform. Its world position follows its parent. The active camera listens from its world position, using its view direction and up vector for stereo panning. Gain stays constant within the inner radius, falls smoothly to zero at the outer radius, and stays silent beyond it. With no active listener, spatial voices advance silently. Destroying the source ends its voices on the next mix.

Pass node `0` for UI or music playback and `true` as the last argument to loop. Gain ranges from zero to one. Each play has an independent cursor and stop handle. A world supports 128 simultaneous voices. Loading or playing returns zero on failure, including when all voices are busy.

### Sound groups

A group holds interchangeable clips, such as four footsteps on stone. Each play picks one at random, never the one the group played last, and varies its pitch and gain so repeats do not sound mechanical:

```duck
string [] paths = {"Assets/Sounds/stone_1.wav", "Assets/Sounds/stone_2.wav", "Assets/Sounds/stone_3.wav"}
// Pitch within ±6 %, and up to 20 % quieter.
int stone = world.LoadSoundGroup(paths, 0.06, 0.2)
world.PlaySoundGroup(stone, footNode, 0.5, false)
```

`CreateSoundGroup(pitchJitter, gainJitter)` and `AddToSoundGroup(group, clip)` build a group from clips already loaded. Both jitters are fractions from 0 to 0.5. `LoadSoundGroup` leaves out files that fail to load and returns zero only when none loads. `SeedSoundRandom(seed)` makes the picks repeatable. `PlaySoundGroupPitched(group, node, gain, looping, basePitch)` plays around a base pitch from 0.25 to 4, so one group can voice a small creature high and a large one low; the jitter applies on top. `PlaySoundPitched(clip, node, gain, looping, pitch)` plays one clip at a fixed pitch from 0.25 to 4, where 2 is an octave up at twice the speed.

### Reverb

Each world has one reverb, set to the room it imitates. Voices are dry until a share of them is sent to it:

```duck
QuaxelReverbSettings hall
hall.RoomSize = 0.85   // 0 small room to 1 large hall
hall.Damping = 0.3     // 0 bright stone to 1 soft furnishings
hall.Wet = 0.45        // level of the reverb in the mix
world.SetReverb(hall)
long step = world.PlaySoundGroup(stone, 0, 0.12, false)
world.SetVoiceReverb(step, 0.5)
```

All values range from 0 to 1, and out-of-range values are refused. The tail keeps ringing after its voice ends and carries into new settings; `ClearReverb()` silences it, as on a cut to another place, and `Release()` does too. The reverb is Freeverb-style: four damped comb filters and two allpass filters per channel at 48 kHz, with the first echo after about 25 ms.

To choose a group by what is underfoot, `terrain.SurfaceAt(x, z)` gives the surface of the column under a world point: a `QuaxelTerrainSurface` value or a game's own, or -1 where no chunk is loaded.

Windows queues up to four blocks of 800 stereo frames, about 67 ms in total. Position changes and stops affect newly mixed blocks. A render stall longer than the queued audio can cause a gap. Headless runs and Windows runs without an output device advance the mixer once per simulation step.
