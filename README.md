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

## Browser build

With a Memory64-capable Emscripten SDK activated, run
`./build.ps1 -Platform web -Profile release` here to build the engine, or in
Hellfeather to build the playable game. The game uses its existing Duck entry
point, simulation and assets. From the Hellfeather repository:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory .duck/build/web/wasm64/release/site
```

Open `http://127.0.0.1:8000/Hellfeather.html` in a browser with WebGPU,
WebAssembly Memory64 and JSPI. Deploy the contents of `site/` together.
The page unpacks the game assets before startup and keeps saves in browser
storage for the game's origin. Each frame yields to the browser's animation
scheduler. A key press or pointer press enables audio.

`Quaxel.Web.dkp` selects the browser file bindings and window, input, audio and
graphics backend in `Source/Platform/Web/`. WebGPU traces voxel bricks, renders
meshes, directional sunlight and shadowed point lights. Particle simulation and stamping
use GPU compute passes generated from the Vulkan effect kernels. The HUD uses a separate WebGPU canvas at its logical resolution. Dynamic diffuse global
illumination and the Windows GPU benchmark are currently
available on the Vulkan backend. The web build ships WGSL shaders from
`Source/Platform/Web/Shaders`. After editing the GLSL voxel or effect kernels,
regenerate their WGSL with `python Tools/Web/shaders.py` using Vulkan SDK
`glslc` and Naga (`naga-wasi-cli@0.1.0`, or pass `--naga PATH`).

## Current foundation

`Quaxel.dkp` is a library project without `Main`. `Source/Core/Runtime.dk`
provides a version query, a fixed simulation step, and a caller-owned
`QuaxelSession`. A session starts stopped at frame zero. `Begin()` starts or
restarts it, `Advance()` increments the frame while running, and `Stop()` keeps
the last frame available. Games can read the `Frame` and `Running` properties.
The static `Quaxel` functions still accept separately stored frame and running
values.
Game logic and the shared engine are written in Duck. The web backend also uses C, C++, JavaScript and GLSL.
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

### Generated music

`world.Music` composes and synthesizes background music while it plays, with no audio files:

```duck
world.Music.Start((uint)1)   // the same seed plays the same music
world.Music.Volume = 0.6
QuaxelMusicSection now = world.Music.CurrentSection()
```

The composer builds a song from `QuaxelMusicSection` parts: intro, verse, pre-chorus, chorus, post-chorus, bridge, instrumental, breakdown and outro. It picks each section from the three before it and writes it one section ahead of playback. Each section decides which `QuaxelMusicInstrument` parts play: drone, pad, bass, plucked riff, bell, reed lead, wind, metal, low drum, frame drum and shaker. Each instrument keeps a two-bar pattern for every kind of section, so a returning chorus brings back its riff, slightly varied. The chords default to C, G, Am and F, one a bar. `Music.ClearChords()` and `Music.AddChord(root, third)` replace them from the next section on, and `Music.SetMode(mode)` writes in another scale with its own progressions. `SetTempo(bpm)` changes the tempo, which defaults to 72. After an outro a new song starts with new riffs.

Each section is written during the last bar of the one before, so it also answers the listener's surroundings, given as a `QuaxelMusicContext` with values from 0 to 1:

```duck
QuaxelMusicContext around
terrain.SampleSurroundings(player.X, player.Z, 40.0, around)   // Water, Mountains, Structures
around.Interior = insideBuilding ? 1.0 | 0.0
around.Danger = Math.Min(1.0, nearbyEnemyThreat)
world.Music.SetSurroundings(around)        // every frame; the music smooths it
world.Music.EnemyDied(0.3)                 // 1 for a boss
```

Danger favours choruses and solos, adds drums, raises the tempo by up to a fifth and turns the chords minor (Am F C G). A jump in danger cuts a calm section off at the next bar line. Deaths turn the music sombre once the danger has passed: it brings breakdowns and bridges, bells and pads, fewer drums and a slower tempo, fading over about a minute. Interiors silence the wind and bring clangs, drips and a smaller room; water brings drips; mountains bring wind, drones and a longer echo. `Music.Prefer(instrument, weight)` gives a place its own band: 1 plays an instrument as written, 2 about twice as often, and 0 never, even where a fight would add a drum or a solo its soloist. `Music.ClearPreferences()` sets every instrument back to 1. Like the chords and tempo, preferences apply from the next section. `Music.Muted` silences instruments by bit without changing what is written.

`QuaxelMusic` only records what the game asks for and reports what is playing: the composer and voices live in a `QuaxelMusicEngine` that reads a plain-data `QuaxelMusicInbox` once a block and publishes a `QuaxelMusicStatus`. Settings take effect from the next mixed block at the earliest. `Tools/MusicPreview` renders four minutes of a walk, a fight and a cave to `MusicPreview.wav`, then the same piece once per instrument as `Stem-<Instrument>.wav`.

On Windows the audio plays on a thread of its own (`QuaxelAudioThread`, started by the engine's main loop with a `P{ }` task). That thread owns the music engine and the output device: it fills each of the device's four buffers of 800 stereo frames (about 67 ms in all) as it comes free. The main thread mixes the sound effects once a simulation step with `world.MixEffects` and queues them for the thread, and hands the music its settings and surroundings once a frame with `world.Music.Exchange()`. A slow frame therefore delays sound effects, and a queue of three blocks drops its oldest so a burst of steps catches up rather than lagging, but the music keeps playing, even while the window is being resized. Position changes and stops affect newly mixed blocks. If the device refuses a block, the thread ends and the device closes. The browser build has no threads and mixes everything on the main thread, as headless runs and runs without an output device do: they advance the mixer once per simulation step with `world.MixAudio`.
