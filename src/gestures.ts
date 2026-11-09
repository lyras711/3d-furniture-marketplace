/** Touch gesture rules shared by the editor canvas: slop before a drag starts, double-tap detection and multi-touch cancellation. */
export const TOUCH_SLOP_PX = 6
export const TAP_MAX_TRAVEL_PX = 10
export const DOUBLE_TAP_MS = 320
export const DOUBLE_TAP_PX = 24

export type ScreenPoint = { x: number; y: number }
export type Tap = ScreenPoint & { time: number }

export const TWIST_LOCK_RAD = 8 * Math.PI / 180
export const PINCH_LOCK_RATIO = 0.08
export const ROTATION_SNAP_RAD = Math.PI / 4
export const ROTATION_SNAP_TOLERANCE_RAD = 5 * Math.PI / 180
export type TwoFinger = [ScreenPoint, ScreenPoint]
export type TwoFingerMode = 'pending' | 'rotate' | 'zoom'

export const fingerAngle = ([a, b]: TwoFinger) => Math.atan2(b.y - a.y, b.x - a.x)
export const fingerSpan = ([a, b]: TwoFinger) => Math.hypot(b.x - a.x, b.y - a.y)
export const fingerMidpoint = ([a, b]: TwoFinger): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
/** Smallest signed change from one angle to the next, so a twist can pass ±180° without jumping. */
export const angleStep = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
/** A two-finger gesture on a selected item becomes a rotate if the twist passes its threshold before the pinch does; otherwise it zooms the camera. */
export function classifyTwoFinger(twist: number, scale: number): TwoFingerMode {
  const twistRatio = Math.abs(twist) / TWIST_LOCK_RAD, pinchRatio = Math.abs(scale - 1) / PINCH_LOCK_RATIO
  if (twistRatio < 1 && pinchRatio < 1) return 'pending'
  return twistRatio >= pinchRatio ? 'rotate' : 'zoom'
}
/** Free rotation that settles on 45° steps when within 5° of one. */
export function snapRotation(rotation: number) {
  const snapped = Math.round(rotation / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD
  return Math.abs(rotation - snapped) <= ROTATION_SNAP_TOLERANCE_RAD ? snapped : rotation
}

export const beyondSlop = (start: ScreenPoint, current: ScreenPoint, slop = TOUCH_SLOP_PX) => Math.hypot(current.x - start.x, current.y - start.y) > slop
export const isDoubleTap = (previous: Tap | null, next: Tap) => Boolean(previous) && next.time - previous!.time >= 0 && next.time - previous!.time <= DOUBLE_TAP_MS && Math.hypot(next.x - previous!.x, next.y - previous!.y) <= DOUBLE_TAP_PX

const touches = new Set<number>()
const multiTouchListeners = new Set<() => void>()
function trackTouches() {
  // Capture phase on window runs before OrbitControls' canvas listener, so a cancelled drag can re-enable the controls in time for the second finger.
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return
    if (event.isPrimary) touches.clear()
    touches.add(event.pointerId)
    if (touches.size > 1) for (const listener of [...multiTouchListeners]) listener()
  }, true)
  const release = (event: PointerEvent) => { touches.delete(event.pointerId) }
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
}
if (typeof window !== 'undefined') trackTouches()

export const activeTouchCount = () => touches.size

/** Runs `cancel` once when another finger touches the screen. Returns an unsubscribe function. */
export function cancelOnMultiTouch(cancel: () => void) {
  const listener = () => { multiTouchListeners.delete(listener); cancel() }
  multiTouchListeners.add(listener)
  return () => { multiTouchListeners.delete(listener) }
}
