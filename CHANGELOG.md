# CHANGELOG

## 2.4.0 (2026-10-08)
- Minimalist cut bench + custom workbenches (`src/bench.js`, 7th tab): named tool sets
  (paint modes + quick actions + drawer sections + panels + layout) drive the cut bench.
  Ships with Minimal / Cut + Mask / Trace + Path / Retouch / Full presets; Minimal is
  active by default (4 tools, closed drawer, quiet panels). New/duplicate/delete benches,
  tap-to-add tools, rack switcher, manual rack tweaks write back to the active bench.
  All persisted (LS + kv). `GateCut` gains get/setTool + get/setLayout API for it.
- Canvas views (`src/cut.js` §14): intuitive edit↔result split slider (20–80%,
  double-click resets 50/50, 🔒 lock freezes it, per-canvas persist, auto-hides outside
  side layout) + live pop-out mirrors for BOTH edit and result (follow every stroke,
  re-pop refocuses instead of spawning, blocked popups warn instead of failing).

## 2.3.0 (2026-10-07)
- Control rack (`src/rack.js`): sticky one-row bar with the 8 mode buttons + user-pinned tools; everything else lives in a collapsible drawer grouped as source/canvas/history/magic/selection/snap/auto/view modules. Any tool pins to the rack (custom menu), retouch/parts/selections/layers panels collapse, all persisted (LS + kv).

## 2.2.0 (2026-10-06)
- Selections: multiple boxes + multiple lassos, each with its own color, +keep/−out mode, on/off toggle, duplicate/delete, union-crop in result.
- Paths: →selection adds the curve as a poly, ✎ stroke paints it into the mask, ⍈ snap pulls anchors to Sobel-detected edges.
- One-touch: ◎ subject (biggest blob) and ◉ blobs (each piece) via border-flood + connected components + Moore tracing, with bbox fallback.
- Layers: ⧉ copy→layer / ✂ cut→layer with feathered cutout snapshots, visibility/opacity/blend/x-y offset/reorder/rename, 8-step undo.
- Projects: multi-canvas dropdown (new/duplicate/two-tap delete/inline rename), per-canvas state, legacy migration. Layout presets (side/stack/edit/result), composite/mask/base views, pop-out result window.
- Parts grid: save-as element/asset/piece/object kind tags + kind filter.

## 2.1.0 (2026-10-06)
- Shared selection editor (`src/select.js`): 8 handles on the cut crop + every rig region (edge handles move one side only, corners two, drag-inside moves the whole box), per-selection lock/unlock, outline color picker, line styles (solid / dash / dots / x-cross / marching ants, animated). All persisted (LS + kv) and replayed on boot.

## 2.0.0 (2026-10-06)
- Typing gate retired: bench is open, sandbox + keeper unlimited, old profiles migrate silently.
- New Cut Bench (`src/cut.js`, tab 2, boots open): rect crop, lasso polygon, keep/cut mask brushes (size + hardness persist), magic color key (color + tolerance persist), heal spot, clone stamp, feather + contract edge refine, brightness/contrast/saturate/warmth/sharpen retouch. Checker + overlay preview, transparent PNG export, keep-as-note asset, recipe JSON export/import, mask + retouch undo. All fine-tune persists (LS + kv) and replays on boot.
- Dashboard retargeted to bench stats (actions/exports/keeps + XP curve + bench readout + coaching tip). PATCHES drops cut presets + retouch recipes and reacts to cut milestones. Rig Lab self-test always runs caged.

## 1.3.0 (2026-10-06)
- Mascot swap: Dr. Keystroke retired. PATCHES is a silent ragdoll — no motion, no speech. Trigger events sew on patches (24 spots, milestone bonus XP at 6/12/18/24) and drop keeper notes with usable assets (drills, snippets, poses, palettes). Mascot notes never count against the free-tier cap.

## 1.2.0 (2026-10-06)
- Act 1 — Rig Lab (`src/rig.js`, 6th tab): 2D cutout character rigging that works on any image. Canonical 15-part sections map (far/near limbs, pelvis root), drag-to-fit regions + pivots, dice to rigid sprites, layer reorder, FK bone posing with presets + dance, body offset/tilt, PNG/JSON export, keep-as-note asset, tier-aware self-test (local free, caged sandbox pro). Recipe auto-saves; persona reacts to dice/pose/export.

## 1.1.0 (2026-10-06)
- Persona: Dr. Keystroke (mad scientist) + CRASH-01 (crash-test dummy). Persona bar under the gate banner with hand-drawn SVG avatar, mood-ring border (green/amber/red), click-for-quips, persisted mute. Reacts to boot, typing pass/fail/near-miss, sandbox pass/fail/timeout/syntax, keeper saves, level-ups, and the unlock moment.

## 1.0.0 (2026-10-06)
- Ground-up rebuild as Gate One Pro: typing gate (20wpm/90%), iframe-isolated sandbox tester with 3 built-in checks, info logger (filter/pause/JSON+CSV), tag keeper with pins + import/export, learning dashboard (XP/levels/streaks/sparkline/weak keys), kv-backed persistence.
