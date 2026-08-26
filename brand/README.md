# Seek — brand assets

| File | Use |
|---|---|
| `seek-icon.svg` | master: gradient disc on a rounded dark tile |
| `seek-maskable.svg` | Android adaptive icon — full-bleed, mark inside the safe zone |
| `seek-mono.svg` | single colour via `currentColor` — favicon, headers, light backgrounds |
| `seek-lockup.svg` | horizontal icon + wordmark, text as outlines |
| `seek-<size>.png` | 32 / 64 / 120 / 152 / 167 / 180 / 192 / 256 / 512 / 1024 |

`static/` carries only what the app serves; this directory is the source.

## The check is stroked in the tile gradient

Both the tile and the check reference the same gradient in one coordinate
space, so wherever the check overshoots the disc it paints exactly the
background colour. No clip is needed and no fringe survives past the stroke.

**Do not** flatten it to a solid dark stroke, and **do not** clip the check to
the disc — either brings back a visible sliver where the check crosses the
edge. If the tile gradient changes, the check follows automatically.

## Re-deriving the maskable icon

Android crops to a circle or squircle of its choosing, so `seek-maskable.svg`
is full-bleed and scales the mark to 0.75 about the centre. The constraint is
the check's tip, not the disc: at 512 it sits ~252px from centre once the 46px
stroke is counted, against a safe radius of ~205.

Scaling the group moves a `userSpaceOnUse` gradient with it, which breaks the
trick above — the check's overshoot stops matching the background and reappears
as a pale tip. `seek-maskable.svg` therefore strokes the check with
`tileUnscaled`, the same gradient carrying the inverse of the group transform.

```sh
rsvg-convert -w 512 -h 512 brand/seek-maskable.svg -o static/seek-maskable-512.png
rsvg-convert -w 192 -h 192 brand/seek-maskable.svg -o static/seek-maskable-192.png
```

## Re-deriving the wordmark

The lockup's "seek" is outlines, not live text, so it renders identically
without Avenir Next installed. To change the wording, regenerate rather than
editing the path — it was baked from `AvenirNext-Medium` at 140px with -2
tracking, sitting on the baseline at (266, 163), using `fontTools`:

```sh
python3 -m pip install fonttools
```

Then draw each glyph through a `TransformPen` carrying
`Transform(0.14, 0, 0, -0.14, penX, 163)`, advancing `penX` by the glyph's
width × 0.14 − 2. The negative y-scale is what flips the font's y-up outlines
into SVG's y-down space.

## Cache-busting the icons

The icon URLs in `src/app.html` and `static/manifest.webmanifest` carry a
`?v=` query. **Bump it whenever the artwork changes.**

The filenames never change and the server sends `cache-control: max-age=14400`,
so without a version a new icon behind an old URL stays invisible for four
hours. That matters more than usual here: iOS captures a home-screen icon once,
at the moment you add it, and never refreshes it afterwards — so a stale fetch
during those four hours gets baked into the home screen permanently.

Changing the version is not enough on its own for a device that already has the
app installed. Delete the home-screen icon and add it again to pick up the new
one.
