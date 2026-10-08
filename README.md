# Cut Bench Pro

Asset cutting + masking + retouching bench, with rig lab, sandbox, logger, keeper, dashboard.

## Flow
1. **Cut Bench** (`src/cut.js`, tab 2, boots open) — upload anything or use the sample card.
   Multiple canvases (projects): dropdown + new/duplicate/two-tap-delete/inline rename,
   per-canvas state (selections, layers, tune, source), shared elements grid.
   Tools: rect boxes (tap empty canvas = new box, tap a box = select+move, handles
   reshape; every box has its own color, ＋keep/－out mode, on/off, dup/del),
   lasso polys (every close = new poly, same per-poly color/mode/on/del),
   ◎ subject (one-touch biggest-blob via border-flood + Moore tracing + simplify,
   bbox fallback) / ◉ blobs (every piece), path tool (→ selection adds a poly,
   ✎ stroke paints the curve into the mask, ⍈ snap pulls all anchors to Sobel
   edges; same add/edit split with big touch handles, empty-drag moves the whole
   path, ↩ undo for every path op, ∿ curved / ┐ sharp per path, nudge pad +
   arrow keys 1px/5px, grid overlay + snap-to-grid, magnetic edge snap with edge
   preview), keep/cut mask brushes, magic color key, heal spot, clone stamp.
   Selection: ◐/◑ inverse toggle (keep inside vs keep outside). Layers: ⧉ copy→layer
   and ✂ cut→layer (cut punches a feathered hole via snapshot cutouts), per-layer
   👁/opacity/blend/x-y offset/reorder/delete/rename, ↩ layer undo, export includes
   visible layers. Parts grid: save as element/asset/piece/object (tag + filter),
   per-node scale/rename/export/edit-back, grid zoom. View: composite/mask/base.
   Layout presets: side/stack/edit/result, intuitive edit↔result split slider
   (20–80%, double-click resets to 50/50, 🔒 locks it, persists per canvas),
   live pop-out mirrors for edit AND result (⧉ edit pop / ⧉ result pop follow
   every stroke, ~1s refresh). Refine:
   feather + contract. Retouch: brightness, contrast, saturation, warmth, sharpen.
   Result previews on a checker, exports as transparent PNG.
   Everything persists (tool settings, mask recipe as replayable strokes, retouch ops,
   adjustments, source thumbnail) to LS + kv mirror and replays on boot. Recipe JSON
   export/import for sharing. Selection boxes (here + rig regions) share one editor:
   8 handles (edges pull one side only, corners two, others never move), drag-inside
   moves the whole box, lock freezes it, outline color + line style (solid / dash /
   dots / x-cross / marching ants) — all persisted. XP: strokes 1, rect/lasso 3-4, magic 6, retouch 3, export 8, keep 5.
2. **PATCHES the ragdoll** (`src/persona.js`) — silent mascot. Cut events (magic, lasso,
   retouch, export, keep), sandbox passes, rig milestones, level-ups sew on 1 of 24 patches
   and drop a keeper note holding a usable asset (cut presets, retouch recipes, palettes…).
3. **Sandbox** (`src/sandbox.js`) — unlimited isolated JS runs, 3s timeout, built-in checks.
4. **Rig Lab** (`src/rig.js`) — 2D cutout character rig (15 parts, dice, pivots, FK pose).
   Tip in-app: cut the character in the cut bench first for cleanest sprites.
5. **Logger / Keeper / Dashboard** — event stream (now with `cut` kind), unlimited notes,
   XP + streak + bench curve + coaching tip.

## Files
- `index.html` — persona bar + 7 tab panels + banner + nav
- `src/core.js` — utils, LS + kv (`gate1`) store, bus, profile/XP
- `src/cut.js` — cut bench engine
- `src/rack.js` — control rack (sticky modes + pinned proxies), tool drawer, UI customize
- `src/bench.js` — workbenches tab: named tool sets (modes + quick actions +
  drawer sections + panels + layout) that drive the cut bench; Minimal by default
- `src/logger.js`, `src/sandbox.js`, `src/keeper.js`, `src/learn.js`, `src/app.js`, `src/persona.js`, `src/rig.js`
- `src/gate.css` — theme

## Reading guide (for collaborators)
- Start here: this README (flow above), then `index.html` — every tab and
  toolbar row has an `<!-- -->` comment saying what it is and which `cut.js`
  section (§) powers it. Element ids end `Btn/El/Ctn/Sel/Input`.
- `src/cut.js` has a header TOC plus `§1–§16` banners — search `§13` etc. to
  jump. Fast index of where features live:
  - multi-box/poly selections → `paintRects` / `paintPolys` (§11), geometry in
    `rectPx` / `tracePolyPath` / `enabledShapes`, union crop in `replayMask` (§3)
  - path →selection / ✎stroke / ⍈snap → `cutPathUseBtn` wiring + `strokeActivePath` /
    `snapActivePath` (§13), curve math `tracePath`/`samplePathPts` (§7), edges
    `ensureEdgeMap` (§6)
  - ◎subject / ◉blobs → `selectSubject` (§13: border-flood + components +
    `mooreTrace` + `douglasPeucker`, bbox fallback)
  - copy/cut→layer → `selectionToLayer`, stack render `composite`/`layerImg` (§5),
    list UI `paintLayers` (§12)
  - projects/layout/pop-out → `switchProject`, `applyLayout`, `popCanvas` (§14:
    side/stack/edit/result + `viewSplit`/`viewLock` + live edit/result mirrors)
  - parts kinds → `sendToGrid`, `paintParts` (§10); recipe share → `recipeJSON` /
    `applyRecipe` (§15); everything is wired in `boot()` (§16)
- Conventions: one IIFE per file exposing `window.Gate*`; touch-first (tap empty
  canvas = new box, tap shape = select/move); non-destructive — the mask is
  replayed from strokes, never baked; storage keys are `gate1.pro.*`.
