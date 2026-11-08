# Platform boundary

Quaxel uses build-time backend binding. Core is independent of the operating
system. Games and engine services call the platform API; only the selected
backend calls native libraries. This does not require Duck interfaces or a
runtime plugin loader.

```text
Hellfeather -> quaxel_core
           -> quaxel_platform -> quaxel_platform_backend
                                Windows OR Headless (Linux: future)
```

## Ownership and dependencies

| Module | Source | Responsibility |
| --- | --- | --- |
| quaxel_core | Source/Core | Portable engine state and logic; no platform dependency |
| quaxel_platform | Source/Platform/Api | Public platform-neutral service contract |
| quaxel_platform_backend | Source/Platform/Windows or Headless | One concrete implementation of that contract |

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

Platform services sit beside core, not inside it. A future application/window
module may depend on both. Backends must not import gameplay or depend on the
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

Headless reports false for window capability and operations and zero for size.
A game can choose its headless path before opening a window.

## Vulkan renderer

After opening the main window, call `QuaxelRenderer.Start()`. On success,
poll with `QuaxelPlatform.PumpWindow(false)` and call `DrawTriangle()` each
frame. Both renderer calls return false on failure. When the client size is
zero, wait for messages and resume drawing after restore. Call
`QuaxelRenderer.Stop()` at shutdown. Closing the native window also releases
the renderer. These operations run on the window-owning thread.

The Windows backend uses Vulkan 1.0, a queue that supports both graphics and
presentation, FIFO presentation, and a single frame in flight. It rebuilds
the swapchain, framebuffers and pipeline when the extent changes or the
swapchain becomes out of date. The triangle's positions and colors come from
the vertex shader. Headless builds omit the Vulkan bindings and link inputs.

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
