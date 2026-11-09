# User interface

Quaxel UI is written in Duck markup. A game overrides `BuildUi` on its
`QuaxelGameInstance` and returns the tree. The engine owns the tree, lays it
out every frame, and draws it over the world.

```c++
HellfeatherGame : QuaxelGameInstance
{
    markup BuildUi()
    {
        return {
            <QuaxelUiPanel X=12 Y=12 Flow=QuaxelUiFlow.Column Padding=10 Color=0xB0101418>
                <QuaxelUiText Id="score" Text="0"/>
                <QuaxelUiButton Id="pause" Text="Pause"/>
            </QuaxelUiPanel>
        }
    }

    UpdateUi(QuaxelUi& ui, QuaxelWorld& world)
    {
        if ui.TakeClick("pause") { Print("paused") }
        ui.SetText("score", QuaxelUi.FormatInt(Score))
    }
}
```

`UpdateUi` runs once per frame, after the fixed steps. A headless run calls it
once per step and draws nothing.

## Tags

Colors are `0xAARRGGBB` display values. A color with zero alpha draws nothing.

| Tag | Attributes |
| --- | --- |
| Every tag | `Id`, `X`, `Y`, `Width`, `Height`, `AnchorX`, `AnchorY`, `Visible` |
| `QuaxelUiPanel` | `Color`, `Padding`, `Spacing`, `Flow` |
| `QuaxelUiText` | `Text`, `Color` |
| `QuaxelUiBar` | `Value`, `Color`, `BackColor` |
| `QuaxelUiButton` | `Text`, `Color`, `HoverColor`, `PressColor`, `TextColor` |

`QuaxelUiPanel` is the only tag that holds children. Duck lets a tag from
another module hold children only when that exact container has a `this{ }`
block, and an inherited block does not count.

## One pixel size

The whole interface shares one pixel size, the size of a font pixel. All
positions and sizes, in markup and in the overlay, are in these UI pixels. There
is no per-element scale, so text, rectangles and sprites cannot disagree.

A game calls `ui.FitPixels(width, height)` in `ConfigureUi` to name how many UI
pixels must fit the window. The engine picks the largest whole-number scale that
fits and multiplies the finished draw list by it. Without `FitPixels`, one UI
pixel is one screen pixel. `ui.ScaleFor(width, height)` returns the scale, for
converting mouse positions in `UpdateUi`.

## Layout

`AnchorX` and `AnchorY` pick the same point in the parent and in the element:
0 is the left or top edge, 0.5 the center, and 1 the right or bottom edge. `X`
and `Y` then offset the element in UI pixels.

A `Width` or `Height` of 0 means automatic. Text, buttons, and panels with a
`Flow` fit their content. Bars and panels with `QuaxelUiFlow.None` take the
space available. Inside a `Flow` panel, an element with no size of its own takes
no space, so give a `None` panel a `Height` in a column or a `Width` in a row.

Hidden elements are not drawn and leave the flow.

## Changing the UI at run time

Elements are found by `Id`. Each call returns false if no element matches.

| Call | Effect |
| --- | --- |
| `ui.SetText(id, text)` | Replaces the text of a text element or button |
| `ui.SetValue(id, value)` | Sets a bar from 0 to 1 |
| `ui.SetVisible(id, visible)` | Shows or hides any element |
| `ui.TakeClick(id)` | True once for each completed button click |

A click needs the left button pressed and released inside the button. Duck has
no number formatting yet, so `QuaxelUi.FormatInt` converts integers for display.

## Sprites and the overlay

For interfaces that change shape with game state, such as an inventory, a game
draws directly each frame in `UpdateUi`. The overlay is drawn over the markup
tree and uses UI pixels. One atlas texel is one UI pixel.

| Call | Effect |
| --- | --- |
| `ui.ConfigureAtlas(width, height)` | Sizes the sprite atlas and clears it to transparent |
| `ui.SetAtlasTexel(x, y, color)` | Writes one `0xAARRGGBB` display color |
| `ui.ClearOverlay()` | Empties the overlay, usually first thing each frame |
| `ui.OverlayRect(x, y, width, height, color)` | Adds a rectangle |
| `ui.OverlayText(x, y, text, color)` | Adds text |
| `ui.OverlaySprite(x, y, atlasX, atlasY, width, height)` | Adds an atlas region |

A texel with zero alpha is transparent. A sprite costs one draw whatever its
size, so paint large textured panels into the atlas instead of building them
from rectangles. The engine uploads the atlas when it changes.

## Rendering

Text uses a built-in 5 x 7 bitmap font, one UI pixel per font pixel. Characters
outside ASCII draw as `?`.

The tree and overlay produce a list of rectangles, glyphs and sprites, which `quaxel_engine` submits
with `QuaxelRenderer.DrawUi` after the voxel volumes. The Windows backend blends
each one into the frame with the `Shaders/Ui.comp` compute shader.
