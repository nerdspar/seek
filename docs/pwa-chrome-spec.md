# PWA Chrome Spec

One contract for the app frame — safe areas, header, and tab bar — shared by
**duffel**, **seek**, **TrueWeb**, and **AfterTaste** so they feel like one
family. Synthesized from the best of each rather than copied from one.

## Where each idea comes from

- **One box, padded once** — safe-area insets are applied in a single place, not
  sprinkled per component. _(duffel)_
- **Clear the blur, not just the inset** — iOS blurs content under the
  translucent status bar and the blur bleeds a few px past the inset the browser
  reports; the header adds a small deliberate gap on top of the inset so the
  title looks placed, not shoved under it. _(seek's `--status-clearance`; duffel
  does the same with a hard-coded `pt-6`)_
- **Tab bar is a flex child, never `position: fixed`** — in an installed iOS PWA,
  `fixed` anchors to the visual viewport, not the screen, and drifts. _(duffel)_
- **The tab bar's blurred surface reaches the screen edge** — it carries its own
  bottom safe-area padding so the blur fills the home-indicator strip instead of
  a bar floating above bare page. _(seek / TrueWeb)_
- **Everything tappable is ≥ 44px.** _(all)_

## Canonical tokens

Same names in every app (`:root`), so a rule reads the same everywhere.

```css
:root {
  /* Physical insets — not design choices. 0 on a device without notches. */
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);

  /* The blur bleeds past the reported inset; one knob for the extra header gap. */
  --status-clearance: 10px;

  --tap: 44px;      /* minimum touch target (Apple HIG) */
  --tabbar-h: 56px; /* tab-bar row height (content, ≥ --tap); + --safe-b below it */
  --gutter: 16px;   /* standard side padding */
}
```

## The frame

A flex column that fills the screen; the header and tab bar are its bookends and
the body is the one scroll region.

```
┌ shell: 100vh, flex column ──────────────┐
│  padding: --safe-t --safe-r 0 --safe-l   │  ← top + sides handled ONCE here
│ ┌ header (sticky, blur) ───────────────┐ │
│ │ padding-top: --status-clearance      │ │  ← gap clears the blur
│ └──────────────────────────────────────┘ │
│ ┌ main (flex: 1; min-height: 0; scroll)┐ │  ← the only scroll container
│ └──────────────────────────────────────┘ │
│ ┌ tab bar (flex child, blur) ──────────┐ │
│ │ min-height: --tabbar-h               │ │
│ │ padding-bottom: --safe-b             │ │  ← blur reaches the screen edge
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

Rules:

1. **Shell**: `height: 100vh` (not `100dvh` — on an installed iPhone `100dvh`
   reports the screen *minus* the status bar and leaves the tab bar floating
   ~59px up), `display: flex; flex-direction: column; box-sizing: border-box`,
   `padding: var(--safe-t) var(--safe-r) 0 var(--safe-l)`. The **bottom** inset
   is deliberately not here — the tab bar owns it (next).
2. **Header**: a `flex: none` bookend at the top (not `sticky`, not overlapping
   — content scrolls in `main` *below* it), translucent background +
   `backdrop-filter: blur(…)`, `padding-top: var(--status-clearance)` (the shell
   already cleared the physical inset; this gap keeps the title off the
   status-bar blur).
3. **Main**: `flex: 1; min-height: 0; overflow-y: auto`. It does **not** pad for
   the tab bar — the bar is a sibling that takes its own space — only a little
   end-of-list breathing room (`padding-bottom: 16px`).
4. **Tab bar**: a `flex: none` child (never `fixed`), translucent background +
   `backdrop-filter: blur(…)`, top border, row `min-height: var(--tabbar-h)`,
   `padding-bottom: var(--safe-b)` so the blur fills the home-indicator strip.
   Each item is a ≥ `--tap` column (icon + label).

## Per-framework notes

- **SvelteKit (seek, TrueWeb)**: the shell is the root `+layout.svelte`; header
  and `<TabBar>` are components rendered inside it, `main` between them. Moving
  the scroll from the window into `main` is the one structural change — see the
  migration note in each repo when it lands.
- **React (duffel)**: already here (`#root` + `Shell`); align token names only.
- **Next (AfterTaste)**: the app-group `layout.tsx` is the shell; add
  `viewport-fit=cover` and the tokens, replace inline `env()` with them.

## Checklist (per app)

- [ ] Tokens above defined once in the global stylesheet.
- [ ] Root/shell is a `100vh` flex column padded `--safe-t/r/l` (not bottom).
- [ ] Header is sticky + blurred with a `--status-clearance` top gap.
- [ ] One scroll container (`main`), not the window; no per-page tab-bar padding.
- [ ] Tab bar is a flex child (not `fixed`), blurred, `--tabbar-h` + `--safe-b`.
- [ ] Every tab/control ≥ `--tap`.
