# Platform boundary

Quaxel uses build-time backend binding. Core is independent of the operating
system. Games and engine services call the platform API; only the selected
backend calls native libraries. This does not require Duck interfaces or a
runtime plugin loader.

```text
Hellfeather -> quaxel_engine -> quaxel_core
                             -> quaxel_platform -> quaxel_platform_backend
                                                   Windows OR Headless (Linux: future)
```

## Ownership and dependencies

| Module | Source | Responsibility |
| --- | --- | --- |
| quaxel_core | Source/Core | Portable engine state and logic; no platform dependency |
| quaxel_platform | Source/Platform/Api | Public platform-neutral service contract |
| quaxel_platform_backend | Source/Platform/Windows or Headless | One concrete implementation of that contract |
| quaxel_engine | Source/Engine | The main loop; joins core to the platform API |

`Quaxel.dkp` builds core by itself. `Quaxel.Windows.dkp` and
`Quaxel.Headless.dkp` each reference core and select exactly one implementation
of `quaxel_platform_backend`. Their public API source is identical. All backends
implement the same `QuaxelPlatformBackend` function signatures. Missing or
incompatible functions fail when the shared API is compiled. Including two
backend projects is rejected because their module names collide.

Games depend on `quaxel_platform` and `quaxel_core`, never on the backend module.
Duck checks direct module dependencies: importing the shared API does not expose
backend functions. This is an architectural boundary, not a security boundary;
a developer could deliberately add a backend dependency to a manifest.

Platform services sit beside core, not inside it. `quaxel_engine` depends on
both. Backends must not import gameplay or depend on the
shared API, which would introduce a cycle. Core must remain independently
buildable with no window system or native platform libraries.

## Current contract

The public functions are:

- `bool QuaxelPlatform.SupportsWindowing()`
- `bool QuaxelPlatform.GetClockFrequency(long& frequency)`
- `bool QuaxelPlatform.ReadClock(long& ticks)`

Clock outputs must be initialized mutable variables, as required by the current
compiler. Frequency is positive on success; readings are nonnegative ticks.
Failure returns false and clears the output to zero. Compare readings from the
same backend/session and divide their difference by its frequency for seconds.
Clock values are not wall-clock dates.

Windows supplies a performance counter and a resizable main window.
The Windows backend links User32 and Kernel32 and owns the native window handle,
window procedure and message queue processing.

## Main window

Use the following functions on `QuaxelPlatform` from the window-owning thread.
The x64 Windows backend supports one main window per process.

| Function | Behavior |
| --- | --- |
| `OpenWindow(title, width, height, visible)` | Creates a window with a UTF-16 title and positive client dimensions. Returns false on failure or if one is already open. Pass false for a hidden window. |
| `PumpWindow(wait)` | Dispatches pending messages. Pass false to poll or true to sleep until input is available. Returns false on closure, quit, or wait failure. |
| `GetWindowSize(width, height)` | Reads current client dimensions after programmatic or user resizing. Clears both outputs on failure. |
| `ResizeWindow(width, height)` | Requests new client dimensions while preserving position. Returns true on success. |
| `RequestWindowClose()` | Queues a close request. Pump messages to complete it. |
| `CloseWindow()` | Destroys the window immediately and releases its class. Safe to repeat. |
| `SetRedrawHandler(handler)` | Sets a function called during live resize, while the normal loop is blocked. `ClearRedrawHandler()` removes it. |
| `ConsumeWindowStall()` | Returns true once after a window drag blocked the loop, so that time is not simulated. |

Headless reports false for window capability and operations and zero for size.
`QuaxelEngine.Run` uses this to select its headless path.

## Input

`QuaxelPlatform.IsKeyDown(key)` reports whether a key is held, using `QuaxelKey`
values. The Windows backend tracks key-down and key-up messages. It clears held
keys when the window loses focus or a modal drag starts. Headless builds report
no held keys.

`GetMousePosition(x, y)` reads the last pointer position in client pixels, and
`IsMouseButtonDown()` reports the left button. The Windows backend captures the
mouse while the button is held and releases it on focus loss or a modal drag.
Headless builds report no pointer.

## Files

The platform layer has no file API of its own. Engine and game code use Duck's
built-in `file` type (`Open`, `Read`, `ReadText`, `Create`, `Write`), which works
the same in headless and Windows builds. `QuaxelAssets` searches the working
directory and up to six parents for an asset, so games find their files when run
from a build output directory.

## Vulkan renderer

The engine starts Vulkan on the window-owning thread. It uploads new and
edited voxel volumes before opening a frame. Volumes are traced nearest
first, so later ones stop early where nearer ones already hit. Each visible
volume dispatches an 8×8 compute shader over its projected screen rectangle.
Rays clip to the volume and stop at the first occupied cell or the closest
depth already written by another volume.

The trace does not shade. For each pixel it writes the voxel color with its
ambient occlusion in the top byte, the depth, and the world normal of the face
it hit as signed bytes. Occlusion comes from the cells around the face and
from the occupancy of 2×2×2 and 4×4×4 blocks further out, all read from the
volume's mask. One lighting pass then shades every pixel with sunlight and
ambient sky light. Sunlight needs a clear path: a shadow ray walks every
caster volume with the same brick and block skipping as the trace. The
casters are bound together as an array of up to 256 storage buffers, which
needs the `shaderStorageBufferArrayDynamicIndexing` device feature. UI is
drawn after lighting, and a transfer copies the finished colors to the
swapchain image for FIFO presentation.

The backend uses one graphics/compute/present queue and one frame in flight.
Resizing recreates the output buffer and swapchain. Volume storage survives
resize and expires when the renderer stops. The low-level indexed graphics
API remains available for explicit graphics clients. Headless builds omit
the Vulkan bindings and link inputs.

## Text contract

Duck `string` is UTF-16 on every platform, using 16-bit code units. Duck `name`
is UTF-8. These are distinct language types; a code unit is not necessarily an
entire Unicode character. Public window titles and text use `string`. Do not
replace this contract with platform-dependent wchar_t/TCHAR storage.

The Windows backend passes UTF-16 titles to CreateWindowExW. Other
backends convert explicitly when their APIs require another encoding. The
conversion, buffer lifetime, and any native terminator requirements belong to
the backend. Core and gameplay do not select encodings based on the OS.

The compiler now implements immutable `name` and `string` values, explicit
encoding conversion and read-only native borrowing. `cstring` remains a separate
immutable, null-terminated UTF-8 literal-pointer interop type. Native string
returns and writable buffers still need ownership and validation support.

## Adding Linux

Add `Source/Platform/Linux/` and `Quaxel.Linux.dkp`. Reference `Quaxel.dkp`, compile
the same shared API source, and provide the same backend module/functions. Keep
Linux-native library names and event translation inside that backend. A Linux
implementation can select Wayland or X11 internally without changing game code.
A renderer-specific surface adapter may also live alongside it.

Linux is not implemented or validated yet. Selecting a backend is not
cross-compilation: Duck/Clang and native libraries must support the target.

## Verification

Run the engine tests with Duck from the repository root. Each platform manifest
runs the core session tests and tests the shared API against its selected backend.
The mock project supplies controlled clock readings and failure results.

```powershell
../Duck/duck.cmd test Quaxel.Headless.dkp
../Duck/duck.cmd test Quaxel.Windows.dkp
../Duck/duck.cmd test Tests/Mock.dkp
```

Run the Windows manifest on Windows. Add `--profile release` to any command
to test the optimized build.

For Windows tests, run `./configure-vulkan.ps1` once after installing the
x64 Vulkan SDK. Set `$env:VK_INSTANCE_LAYERS = 'VK_LAYER_KHRONOS_validation'`
and `$env:VK_LAYER_VALIDATE_SYNC = '1'` to enable validation while running
the Duck render, resize and restart test.

`python Tests/platform.py` checks build artifacts and compiler diagnostics,
including headless native dependencies, missing methods, duplicate backends,
and direct dependency boundaries.
