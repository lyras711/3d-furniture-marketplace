# Mobile-first simplicity plan — 2026-11-08

Goal: a first-time user, including an older relative, can open the planner on a phone, build their apartment, and furnish it without help. Desktop keeps its current layout except where noted. Builds on [[2026-11-08-room-measuring]] and [[2026-10-03-editor-ux-redesign]].

## Decisions (confirmed with user)
- Mobile uses a **full-screen canvas**. On mobile there is no Room/Furnish/Review step bar.
- Touch: **tap to select, then drag to move**.
- Wall items: **sample catalogue products** (marked unverified, like the existing samples) plus the user's own wall items.
- Door/window v1: **size presets, hinge & swing side, styles**. Frame colour is deferred.

## Design principles (acceptance bar)
1. One obvious next action on screen. Everything else is hidden until it is needed.
2. Every gesture has a visible button that does the same thing: pinch → zoom buttons in the menu, twist → Rotate, double-tap → "+ Add".
3. Touch targets ≥ 48 px, mobile text ≥ 15 px, plain words ("Plan" / "3D", "Add furniture", "Opens inward").
4. No confirmation dialogs for reversible actions. Use an Undo toast ("Sofa removed · Undo").
5. Each gesture shows a one-time hint on first use. Hints are stored in localStorage and can be dismissed.

## Phase 0 — Gesture foundation (fixes the zoom bug)
**Root cause:** `DraggableObject.onPointerDown` (`src/App.tsx` ~511) starts a drag on the first finger. It also disables OrbitControls. When a pinch starts on an item, the second finger never reaches the camera, and the item moves instead.

**Plan:** add a canvas-level touch gesture controller (`src/gestures.ts`). The gesture classifier is pure and unit-tested; a thin hook connects it to `gl.domElement`. It tracks all active pointers:
- One finger on the **selected** item: after a 6 px slop, move the item.
- One finger anywhere else: orbit in 3D, pan in Plan view. A tap without movement selects or deselects.
- Two fingers: pinch zooms and pans the camera, always. If a drag is in progress, the second finger cancels it and restores the pre-drag snapshot (`dragSnapshot` already exists).
- Double tap (2 taps < 300 ms, < 24 px apart) on empty floor inside a closed room opens the Add sheet (Phase 2) at that point. On desktop, double-click does the same. Outside a room, show the hint "Tap inside a room to add furniture".
- OrbitControls `touches` is configured per view (`ONE: ROTATE/PAN`, `TWO: DOLLY_PAN`) and is enabled or disabled per gesture, not globally.

**Tests:** multi-touch CDP helpers (extend `touchDrag` to two touch points). Pinch on an item must leave the item's x/z unchanged and change the zoom. Drag on an unselected item moves the camera, not the item. Double tap opens Add.

## Phase 1 — Mobile shell (full-screen canvas)
New `src/MobileShell.tsx`, rendered when `compact`. It reads the same state and handlers as `App` (no duplicated logic).
- **Always visible:** menu (top left), Undo (top right), "Plan | 3D" switch (bottom left), large **"+ Add"** button (bottom centre).
- **Menu sheet:** project name, Save, Share, Basket (badge also on the menu icon), Measure a room, Draw walls, Room size, Templates, Import plan, View options, Profile, New project.
- **Context bars (only when relevant):**
  - Item selected: Rotate · Copy · Basket · Delete · Details.
  - Wall tapped: Add door · Add window · Add wall item · Delete wall.
  - Door/window tapped: opens its edit sheet (Phase 4).
  - Drawing walls: a single bar, "Undo corner · Finish".
- **Empty project:** a full-screen welcome with four large choices: Measure my room (primary), Draw it on screen, Enter a room size, Use an example room.
- Remove canvas tips, the floating tool toolbar and the step nav on mobile. A one-line hint appears only during a mode.
- Desktop layout is unchanged.

**Risk:** many 375 px tests use the bottom nav ("Room step", "Close panel", …). Those tests are rewritten for the new shell, and AGENTS.md accessible-name rules are updated. The desktop tests stay as they are.

## Phase 2 — Simple "Add" sheet
New `src/AddItemSheet.tsx`, a half-height bottom sheet:
- Room tabs: Living · Bedroom · Dining · Kitchen · Bathroom · Wall decor · My own items. The tabs come from a category → room map, not new product data.
- A 2-column grid of large thumbnails with name, size and price. Search sits behind an icon. No retailer/sort filters on mobile.
- Tap = place. The item goes at the double-tap point, or the visible room centre, nudged to the nearest valid spot with `placeObject`. Then the item is selected and the sheet closes with an Undo toast. If nothing fits: "No space for this here — try another spot."
- Open question: should desktop's Furnish panel also use this simpler list? The default is no; only double-click-to-add comes to desktop.

## Phase 3 — Two-finger rotate
- Part of the Phase 0 controller. With an item selected, if the twist exceeds 8° before the pinch scale changes by more than 8%, the gesture locks into **rotate item**. Otherwise it zooms the camera.
- Rotation is free, with a magnetic snap to 45° multiples (±5°). A live angle label is shown during the twist. One history entry per gesture. Group selections rotate about the group centre (`rotateSelection` logic).
- The Rotate button (15°) stays as the visible fallback.

## Phase 4 — Door & window customisation
- **Model:** optional `RoomFeature` fields: `style` (door: `hinged | double | sliding | opening`; window: `casement | fixed | balcony`), `hinge: 'left' | 'right'`, `swing: 'in' | 'out'`. Old data defaults to hinged/casement. Schema stays v3 with validation added to `isProject`. Defaults are migrated, never silently rewritten.
- **Presets (cm):**
  - Doors: single 80×210, wide 90×210, double 140×210, sliding 160×210, opening 90×210.
  - Windows: small 60×60 (sill 110), standard 120×140 (sill 90), large 180×150 (sill 80), balcony door 90×220 (sill 0).
  - An "Exact size" expander keeps the numeric fields.
- **Rendering** (`SceneEnvironment.tsx` openings):
  - Per-style geometry: double = two leaves; sliding = offset panel, no arc; opening = no leaf; fixed = no handle; balcony = full-height glazing.
  - The Plan-view swing arc follows hinge and swing; double doors get two arcs.
  - Door-clearance warnings use the real swing area.
- **UI:** an edit sheet with pictogram style tiles, preset chips, "Flip hinge", "Opens inward / outward", and Delete.
- **Tests:** model validation/migration, swing-area clearance, 2D arc direction, screenshots.

## Phase 5 — Wall-mounted items
- **Catalogue:**
  - `Product.mount?: 'floor' | 'wall'` and `mountHeight` (cm to the bottom edge).
  - New authored sample products: painting, mirror, floating shelf, wall TV, upper kitchen cabinet. They use procedural geometry plus generated thumbnails, with status "Sample · price & stock unverified". No invented retailer claims beyond the existing sample convention.
- **Model:**
  - `RoomObject` gains optional `wallId`, `wallOffset` and `elevation` (m). Position and rotation are derived from the wall, like openings, so items follow wall edits.
  - `CustomRoomItem.kind` adds `'wall'`.
- **Validation:**
  - The item lies within the wall length and below the ceiling.
  - It doesn't overlap doors/windows or other wall items on the same wall.
  - Warning, not a block: it collides with a tall floor item in front.
- **Interaction:**
  - From Wall decor in the Add sheet, the mode "Tap a wall to hang it" starts. From a tapped wall, "Add wall item" opens the sheet filtered to wall items.
  - Drag slides the item along the wall in Plan view, and along or up/down in 3D. Height is also in Details.
- **Scope:** basket, CSV, quotes, render studio and GLB export include wall items. Floor-fit checks ignore them.
- **Tests:** follows wall on reshape, rejects overlap with openings, survives save/share/migration, appears in the basket.

## Phase 6 — Simplicity pass and user testing
- One-time hints for pinch, tap-to-select, double-tap-to-add and twist.
- Undo toasts on delete, replace and measure-build.
- Audit target sizes and text against the principles; screenshots at 375 px and desktop.
- `testing/` note: a 3-task script (measure/draw the flat, add a sofa and rotate it, add a door and a painting). Run it with 2–3 older users and record where they get stuck.

## Order
0 → 1 + 2 (the shell needs the Add sheet) → 3 → 4 → 5, with 6 running throughout. Phase 0 can ship on its own as a bug fix.

## Verification per phase
`npm run build`, `npm test` (mobile tests updated in Phase 1), new geometry/gesture unit specs, and 375 px + desktop screenshots. Cross-check against this note before marking a phase done.

## Progress
- 2026-11-08 — **Phase 0 done.** Touch gestures as specified, plus the same pinch fix in the wall tool (no stray corner). Double-tap opens the existing Furnish panel. Phase 2 replaces that with the Add sheet. On mobile, the full-height sheet hides the ring marker, so the toast says "where you tapped". 87/87 tests pass. Details in AGENTS.md "Touch gestures".
- 2026-11-08 — **Phases 1 + 2 done.**
  - Mobile shell, welcome screen, menu, Add sheet and wall door/window actions, as in AGENTS.md "Mobile shell".
  - Deviation: the shell is rendered inside `App` (it shares all editor state) rather than a separate `MobileShell.tsx`. Only `AddItemSheet` and `ui.tsx` were extracted.
  - Mobile tests were rewritten for the new layout, plus one new Add-sheet/wall test. 88/88 pass.
  - **Open follow-up:** the Room panel sheet still shows desktop-oriented copy.
- 2026-11-08 — **Plan-view fit done.** Plan view frames the rooms (a 4.2 m room now fills a 375 px screen width). Tests map taps through `data-plan-*`. Toasts already clear after 4.5 s, so they were not an issue. 88/88 pass.
- 2026-11-08 — **Phase 3 done.** Two-finger rotate as specified, including groups, the 45° snap, the live angle label and a single undo step. A twist with nothing selected only moves the camera. 92/92 tests pass.
- 2026-11-08 — **Phase 4 done.** Door/window styles, size presets, hinge and swing, plan symbols, 3D geometry and swing-aware clearance. User request added: placing an opening ends the tool. Also fixed the desktop plan fit, which had reserved inspector space on both sides. Frame colour is still deferred.
- 2026-11-08 — **Phase 5 done.**
  - Wall-mounted items as specified. Deviation: the sample items use the existing honest placeholder convention (no price, no retailer claim) rather than "sample prices".
  - Not done: snapping wall items to each other, moving a wall item to a different wall by dragging (re-hang it by deleting and re-adding), and wall items on curved or very short walls.
  - 97/97 tests pass.
- 2026-11-09 — **User feedback round.** Basket badges on items; freehand sketch → walls (start option only); wall building redone Sims-style (drag-to-draw, Room box, Erase, tap a length to edit; works in 3D). User-confirmed choices: drag-to-draw replaces tap-to-chain; tools Room + Erase + tap-length; sketch is a start option only. 102/102 tests pass. Phase 6 (hints, undo toasts, user testing) is still open.
