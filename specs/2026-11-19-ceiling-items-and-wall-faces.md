# Ceiling items and wall-face picking (2026-11-19)

Request: items that hang from the ceiling; wall items sometimes hung behind the wall they were dragged onto.

## Root cause (wall items)
- Catalogue drops located the point only on the floor plane. In 3D the ray passes through the wall and hits the floor behind it, so the item took the far wall face (or a different nearest wall).
- In plan view the face was chosen from a 3 cm (t/4) tolerance, so a drop a few cm outside an exterior wall hung the item outside.

## Decisions
- Drops raycast walls first; the hit wall and face win over a selected wall.
- The outside face of a wall that bounds a room is never chosen automatically. Shared and free-standing walls follow the point/face.
- Ceiling items are floor-placed objects with a derived `elevation` (top at the ceiling). No adjustable drop length yet.

## Verification
- `editor-model.spec.ts`: wall-face cases (exterior, shared, free-standing) and ceiling model rules.
- `editor.spec.ts`: plan + 3D wall drops stay inside the room; ceiling items add/rotate/render. Captures `/tmp/forma-wall-drop-3d.png`, `/tmp/forma-ceiling-items-3d.png`.

See [[2026-11-08-mobile-simplicity-plan]].
