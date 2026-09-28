# PWA Chrome Spec

One contract for the installed-PWA frame — status bar, safe areas, header, and
tab bar — shared by **duffel**, **seek**, **TrueWeb**, and **AfterTaste** so they
feel like one app family, and the starting point for any new phone-first PWA.

This is the *current* recipe, hard-won against iOS 26/27. If something here looks
fussy, it is load-bearing — read the reasoning before changing it.

---

## TL;DR — the recipe

1. **No `viewport-fit=cover`.** This is what kills the iOS top-edge blur.
2. **`apple-mobile-web-app-status-bar-style: default`** (opaque), never
   `black-translucent`.
3. **A fixed opaque `.status-tint` strip** at the very top edge (standalone only).
4. **Reserve the home indicator yourself:** with no `cover`,
   `env(safe-area-inset-bottom)` is `0`, so override the bottom inset to
   `max(env(...), 34px)` in `@media (display-mode: standalone)`.
5. **One tab-bar spec everywhere:** 56px band · 24px icon · 11px label · 4px gap ·
   + the home-indicator cushion below it.
6. **Shell is `100dvh`,** never `100vh`.

Everything below is the why and the how.

---

## The iOS top-edge blur (the whole reason this doc exists)

Installed on iOS 26/27, a standalone PWA gets an uncloseable "Liquid Glass"
scroll-edge effect: a ~40pt system blur ramp over the **top** edge. It falls on
your header/title and there is no meta or CSS that turns it off directly.

What actually defeats it, in combination:

- **Drop `viewport-fit=cover`.** With `cover` the web view spans the whole screen
  and iOS draws the ramp over the top of your content. **Without** it, iOS keeps
  the web view inside the safe area — *below* the status bar — so the ramp has
  nothing to fall on. This is the single most important line.
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  ```
- **`status-bar-style: default`.** `black-translucent` is what most strongly
  triggers the ramp; `default` gives an opaque status bar coloured by
  `theme-color`, and since content is already below it, you lose nothing.
- **A `.status-tint` strip.** A real, fixed, opaque element pinned within a few px
  of the top edge; iOS samples it as solid status-bar chrome. Insurance for
  devices where the ramp still tries to appear.

> **Frozen at install.** `apple-mobile-web-app-status-bar-style` is read **once,
> when the app is added to the Home Screen.** Changing it only takes effect after
> the user **removes and re-adds** the app. Plain CSS/content changes take effect
> on the next relaunch (via the service worker) — no re-add needed.

> **You can't reproduce this in a desktop browser.** The blur, the status-bar
> style, and the safe-area insets are all installed-iOS-only. Validate geometry by
> *simulating* — override the bottom inset token to `34px` in devtools and measure
> — and confirm the blur itself on a real re-added install.

### Known dead ends (don't relitigate)

- **A big top clearance** (pushing the title ~40px down) hides the ramp but looks
  awkward. Rejected.
- **Keeping `cover` + a taller tint / clearance** — still blurred on device.
- **`default` alone, still with `cover`** — still blurred. `cover` has to go.
- **A JS repaint/scroll nudge on mount** to clear a transient first-launch blur —
  tried in AfterTaste, didn't work on device, reverted.

---

## Canonical tokens

Same intent in every app; names may differ per app but keep them consistent
within each (`--safe-*` in seek/duffel, `--sa-*` in TrueWeb/AfterTaste).

```css
:root {
  /* Physical insets — not design choices. 0 on a device without notches. */
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);

  --status-clearance: 10px;                       /* small header gap below the status bar */
  --status-tint-h: calc(var(--safe-t) + 10px);    /* height of the tint strip */

  --tap: 44px;        /* minimum touch target (Apple HIG) */
  --tabbar-h: 56px;   /* tab-bar CONTENT band (the shared height) */
  --gutter: 16px;     /* standard side padding */
}

/* Installed PWA: no viewport-fit=cover forces env(safe-area-inset-bottom) to 0,
   so reserve the iOS portrait home-indicator height. max() still yields to a
   larger real inset if cover is ever reintroduced. A browser tab keeps env()
   (its own chrome handles the bottom). */
@media (display-mode: standalone) {
  :root { --safe-b: max(env(safe-area-inset-bottom, 0px), 34px); }
}
```

Overriding `--safe-b` directly is preferred: **everything** that clears the home
indicator (tab bar, FABs, toasts, bottom sheets, scroll padding) reads it, so one
line fixes them all. (seek uses a separate `--tabbar-safe-b` for the same effect —
equivalent, just narrower in scope.)

**A note on `--safe-b` cascading:** composite tokens like
`--tabbar-footprint: calc(var(--tabbar-h) + var(--safe-b))` resolve `var(--safe-b)`
lazily, so the standalone override flows into them automatically. Define the
footprint once and have the bar, content padding, and every floating element read
it.

---

## The status-bar tint strip

The first element in `<body>` (or the root layout's body), styled globally.

```html
<div class="status-tint" aria-hidden="true"></div>
```
```css
.status-tint { display: none; }
@media (display-mode: standalone) and (orientation: portrait) {
  .status-tint {
    display: block;
    position: fixed;
    inset: 0 0 auto 0;              /* top: 0; full width */
    height: var(--status-tint-h);
    z-index: 3;                     /* above content; below sheets/toasts/modals */
    pointer-events: none;
    background: var(--bg);          /* the app's ground colour; theme-aware */
  }
}
```

Rules the sampler cares about: it must be a **real DOM element** (not a
pseudo-element), **fixed** (or sticky), **within ~4px of the top**, **≥1px tall**,
**≥80% wide**, with a real `background-color`. Keep it shorter than the header's
top padding so it never clips title text, and give it a background that is present
at first paint (a plain token, not something that only resolves after hydration).

---

## The shell

`100dvh`, never `100vh`: with an opaque (`default`) status bar the web view sits
*below* the status bar, so `100vh` (the full screen) overruns the bottom and clips
the tab bar off-screen.

Two shell models are both acceptable — pick per app, don't force one:

### Model A — inner-scroll, flex-child tab bar (seek, duffel)

```
┌ shell: 100dvh, flex column ─────────────┐
│  padding: --safe-t --safe-r 0 --safe-l   │  ← top + sides handled ONCE here
│ ┌ header (flex: none, opaque) ─────────┐ │  ← padding-top: --status-clearance
│ ├ main (flex: 1; min-height: 0; scroll)┤ │  ← the only scroll container
│ └ tab bar (flex child) ────────────────┘ │  ← padding-bottom: --safe-b
└──────────────────────────────────────────┘
```
- The tab bar is a **flex child, never `position: fixed`** — in an installed iOS
  PWA `fixed` anchors to the visual viewport and drifts.
- The bar carries `padding-bottom: var(--safe-b)`; nothing scrolls behind it, so a
  **solid** background (not translucent) reads cleanest and matches the
  home-indicator strip.
- **Cost:** the framework's built-in scroll restoration works on the *window*, not
  an inner container — you must restore `main`'s `scrollTop` yourself across
  navigation (seek's `keepScroll` action).

### Model B — window-scroll, fixed tab bar (TrueWeb, AfterTaste)

```
┌ shell: min-height 100dvh, flex column ──┐
│ ┌ header (in flow) ────────────────────┐ │
│ ├ main (flex: 1; pads bottom for bar) ─┤ │  ← the WINDOW scrolls
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
  tab bar: position: fixed; bottom: 0; padding-bottom: --safe-b   (overlays)
```
- Keeps the framework's free scroll restoration.
- The fixed bar's translucent `backdrop-filter` blur is meaningful here (content
  scrolls behind it) and it fills to the screen edge on its own.
- `main` pads its bottom by the **tab-bar footprint token**, not a hardcoded value.
- Guard drift with `overscroll-behavior-y: none` on `body`.

Both models: content is tight below the status bar automatically (no `cover` →
`--safe-t` is 0 → the header's `calc(--safe-t + N)` collapses to `N`). Keep the
header gap small (`--status-clearance`, ~10px); do **not** add a big top push.

---

## The tab bar (one spec, all apps)

| Property | Value |
| --- | --- |
| Content band height | **56px** (`--tabbar-h`) |
| Home-indicator cushion | **`--safe-b`** (→ `max(env, 34px)` in standalone) |
| Icon | **24px** |
| Label font-size | **11px** |
| Icon → label gap | **4px** |
| Item min hit area | **≥ 44px** (`--tap`) |

So on a home-indicator phone every app's bar is **56 + 34 = 90px** total, with
identical icons, labels, and spacing. Active state carries the accent (fill or
colour); inactive is muted — colour is never the *only* signal.

---

## Anchored elements (FABs, toasts, sheets, scroll padding)

Anything pinned above the tab bar must offset by the bar's **real footprint**, not
a guessed pixel value — otherwise it overlaps the bar the moment the cushion
changes. Define one token and have everything read it:

```css
--tabbar-footprint: calc(var(--tabbar-h) + var(--safe-b));  /* the bar's full height */
```
- Floating buttons: `bottom: calc(var(--tabbar-footprint) + 16px)`.
- A full-width action bar sitting on the tab bar: `bottom: var(--tabbar-footprint)`.
- `main` / scroll containers: `padding-bottom: calc(var(--tabbar-footprint) + 8px)`.
- Bottom sheets: `padding-bottom: var(--safe-b)` so their own content clears the
  indicator.

This was a real bug: after the cushion changed, seek's `+` FAB and AfterTaste's
Add / Start-cook FABs overlapped the taller bar because they used hardcoded
offsets. Tokens, not guesses.

---

## Per-framework notes

- **SvelteKit (seek, TrueWeb).** Meta + the tint `<div>` live in `app.html`; the
  shell is the root `+layout.svelte`. `hooks.server.ts` can rewrite the
  status-bar / theme-color per stored preference (seek) — still always `default`.
- **React + Vite, Tailwind 4 (duffel).** Meta + tint in `index.html`; tokens and
  `#status-tint` in the `@theme` / `@layer base` CSS; `#root` is the single padded
  box (`padding: --safe-*` all sides, `100dvh`). Arbitrary values read the tokens.
- **Next.js App Router, Tailwind (AfterTaste).** The root `layout.tsx` exports
  `viewport` (**omit** `viewportFit`) and `metadata.appleWebApp.statusBarStyle:
  'default'`; the tint `<div>` goes in `<body>`. Tailwind arbitrary values read
  the CSS tokens (`pb-[var(--sa-bottom)]`, `bottom-[var(--fab-bottom)]`); Tailwind
  normalizes `calc(...)` spacing for you. Watch `next-themes`: give the tint a
  background that is present at first paint.

---

## Deploy & verify

- **Ship the shell.** The meta/tint live in the server-rendered HTML (or
  `index.html`); the running server/image must actually serve the new build. A
  "nothing changed" report is almost always a stale deploy or unpushed commit, not
  a CSS bug.
- **Re-add for status-bar changes.** After deploying, remove + re-add the app to
  the Home Screen so the frozen status-bar style takes effect. CSS/JS-only changes
  just need a relaunch.
- **Simulate to verify geometry.** In a desktop browser, set the bottom token to
  `34px` and measure: the bar should be `--tabbar-h + 34`, floating elements
  should clear it, content padding should exceed the bar. Confirm the blur itself
  only on a real install.

---

## New-app checklist

- [ ] Viewport meta has **no** `viewport-fit=cover`.
- [ ] `apple-mobile-web-app-status-bar-style: default`; `theme-color` matches the bg.
- [ ] `.status-tint` element in `<body>` + the standalone/portrait CSS.
- [ ] Tokens defined once; **bottom inset overridden to `max(env, 34px)` in
      `@media (display-mode: standalone)`**.
- [ ] Shell is a `100dvh` flex column (Model A or B), header tight
      (`--status-clearance`, no big push).
- [ ] Tab bar: 56px band · 24px icon · 11px label · 4px gap · `+ --safe-b`; flex
      child (Model A) or fixed (Model B), never a hardcoded bottom pad.
- [ ] Every FAB / toast / sheet / scroll-pad offsets by the footprint token.
- [ ] Every tab / control ≥ `--tap` (44px).
- [ ] Verified by simulating the cushion; confirmed on a re-added install.
