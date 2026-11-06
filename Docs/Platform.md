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

Windows supplies a real performance counter. Headless intentionally supplies no
clock or windows and returns false/zero. Neither backend claims window creation
support yet: both return false from SupportsWindowing. No native window creation
or fake window handles are implemented by this architecture change.

All native imports and native library link inputs belong to the backend.
`Kernel32` appears only in the Windows configuration. Win32 window classes,
structures, callbacks, message codes and HWND values must remain there as window
support is added.

## Window contract to implement next

Once Duck supports containers, native layouts and callbacks, add a public window
API with engine-owned window identifiers/settings/events:

- Create a window from title, client width/height and behavior flags.
- Show, resize, request close, and destroy a window.
- Poll events without blocking the simulation and translate native events into
  Quaxel close, resize, focus, keyboard, mouse and text events.
- Query client size and other supported capabilities without exposing OS structs.

Creation, event pumping and destruction must run on the window-owning thread;
the application layer schedules them explicitly. Unsupported operations must
report failure instead of pretending success. Backend objects own native
resources and release them on destruction and partial initialization failure.
Native handles needed for a renderer belong in a backend/renderer integration
API, not the portable game-facing window API.

These are design requirements, not callable methods in the current bootstrap.
Do not freeze a multi-parameter workaround for window state before containers
are implemented.

## Text contract

Duck `string` is UTF-16 on every platform, using 16-bit code units. Duck `name`
is UTF-8. These are distinct language types; a code unit is not necessarily an
entire Unicode character. Public window titles and text use `string`. Do not
replace this contract with platform-dependent wchar_t/TCHAR storage.

The Windows backend will adapt UTF-16 string storage to its Unicode APIs. Other
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

Run `python Tests/platform.py` (or pass `--builder <duck executable>`). Tests
build a portable core-only program, run both available backends in debug/release,
substitute a test backend without changing the public API, reject missing backend
methods and dual-backend configurations, and verify consumers cannot reach
backend functions through transitive imports. Windows clock tests run on Windows.
