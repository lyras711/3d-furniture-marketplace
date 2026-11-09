# Editor UX redesign — 2026-10-03

## Problem
The planner was hard to use without prior knowledge. Tools, catalogue and room settings shared one sidebar. A permanent inspector showed dense data when nothing was selected. Small type (9–11 px), unlabeled toggles and no clear next step made the flow unclear.

## Decisions
- **Three guided steps**: Room → Furnish → Review. A stepper in the top bar shows progress (room area, item count, basket count). On ≤900 px it moves to a bottom nav, and each step opens in a bottom sheet.
- **Room step**: a "start from a rectangle" form (width × length) creates four walls in one action. Templates and plan import stay one click away. A checklist (walls → door → window) activates each tool and shows progress. Floor and wall finishes are swatches, not selects.
- **Tools on the canvas**: a floating toolbar holds Select/Wall/Door/Window and 2D/3D. Shortcuts are V/W/D/N. "Done" exits a tool, so touch users do not need Escape. Rarely used view settings are in a popover.
- **Contextual inspector**: it appears only when something is selected. Quick actions (rotate, flip, duplicate, basket, delete) sit at the top. "Swap for something similar" sits inside the inspector.
- **Review step**: every placed item has a basket toggle, so users no longer need to select each item to add it. Space-check warnings, render, share and CSV are grouped here.
- 2D plans label every wall length. Base type size is 12–14 px with higher contrast.

## Not changed
Geometry, schema, history, save/cloud sync, purchase-request rules and the render studio are unchanged. The canvas does not resize on selection, so the camera does not jump.

## Follow-ups
- Usability testing with first-time users (see [[testing]] when created).
- Room-size quick start is offered only for empty plans; adding a second rectangle beside existing rooms needs wall de-duplication first.
- The 2D camera fits the whole build grid, not the drawn rooms, because existing tests assume this mapping.
