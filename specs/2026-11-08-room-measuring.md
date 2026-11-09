# Room measuring — 2026-11-08

## Goal
Get a mobile user from an empty project to their own walls in 3D as fast as possible. The user measures one room, wall by wall. The app builds the walls. Then the user adds doors, windows and furniture.

## Decisions
- **One room per session, wall by wall** (user choice).
- **Two capture paths with one result format** (`src/roomCapture.ts`):
  - **AR (WebXR `immersive-ar` + `hit-test`, optional `dom-overlay`)**: the user marks any two floor points along the base of each wall. Each wall is an infinite line, and a corner is where two consecutive lines meet. This means the user never has to reach a corner blocked by furniture. Corners within 7° of square, relative to wall 1, are straightened by default (toggle on review). Hits must be upward-facing surfaces within 12 cm of the first marked floor height.
  - **Manual**: the user enters each wall's length plus the turn at its end (±90° / ±45°). A small closing gap (≤ min(0.5 m, max(0.1 m, 3% perimeter))) is spread with the surveying *transit rule*, which keeps square rooms square. A larger gap is rejected, with an explicit "Add a closing wall" option.
- `projectFromCorners` aligns wall 1 with +X, centres the outline, checks for self-intersection, area ≥ 1 m² and ≤ 38 m extent, and creates a schema-v3 project with `measured-wall-*` walls. The result must form exactly one floor region.
- After a build, the editor shows **3D**, the Room step, and the Select tool, plus a toast that points to doors/windows. The build goes through `setProject`, so Undo restores the previous plan.
- Entry points: "Measure your room" card in the Room panel; "Measure my room" on the empty canvas (primary on mobile); "Measure a new room" in panel links once walls exist.

## Platform reality
- WebXR AR works in **Chrome on ARCore-supported Android phones only**, over HTTPS (or localhost). iPhone/iPad Safari has no WebXR (checked against caniuse and 2026 compatibility tables). On iOS the dialog offers the manual path; Apple's Measure app or a laser works well for each wall.
- **Recommended phase 2 for iPhone camera measuring:** Wrap the planner in Capacitor and add a small native plugin. On iOS the plugin uses ARKit raycasts, which work on all ARKit devices; RoomPlan is an option for LiDAR devices. The plugin returns the same `MeasuredWall[]` to `cornersFromMeasuredWalls`, so the build logic does not change. This needs App Store distribution. Xcode 26.6 is installed. The Android SDK is not installed; Android does not need a native shell because Chrome WebXR already uses ARCore.

## Not done / follow-ups
- The AR path is not verified on a real device. Playwright cannot run an ARCore session. The tests cover the model, the manual flow, the unavailable-AR fallback and AR start failure.
- No ceiling-height measurement in AR (entered on review; default from project).
- No doors/windows capture during the scan; no multi-room sessions (tracking drift).
- Measuring replaces the current plan rather than adding a room next to existing ones (same wall de-duplication limitation as the rectangle quick start, see [[2026-10-03-editor-ux-redesign]]).
