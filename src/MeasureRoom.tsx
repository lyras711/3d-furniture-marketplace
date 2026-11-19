import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, SphereGeometry, WebGLRenderer } from 'three'
import { getFloorRegions, type Point, type ProjectState } from './editor'
import { closeTolerance, cornersFromEntries, cornersFromMeasuredWalls, entryPath, floorPointFromRay, formatMetres, MAX_CAPTURED_WALLS, projectFromCorners, wallsFromCorners, type CaptureResult, type WallEntry } from './roomCapture'

type Mode = 'choose' | 'manual' | 'ar' | 'review'
type Live = { status: 'searching' | 'floor' | 'aim-lower'; distance: number | null; closing: boolean }

const turns = [{ value: 90, label: 'Right 90°' }, { value: -90, label: 'Left 90°' }, { value: 45, label: 'Right 45°' }, { value: -45, label: 'Left 45°' }]
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const CLOSE_SNAP = 0.25

export const arMeasureSupported = (): Promise<boolean> => navigator.xr?.isSessionSupported('immersive-ar').catch(() => false) ?? Promise.resolve(false)

function PlanPreview({ segments, polygon, label }: { segments: [Point, Point][]; polygon?: Point[]; label: string }) {
  const points = segments.flat()
  if (!points.length) return <div className="measure-plan measure-plan-empty" role="img" aria-label={label}>Your plan appears here as you measure</div>
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const size = Math.max(maxX - minX, maxZ - minZ, 1), pad = size * 0.2
  const centre = { x: xs.reduce((sum, x) => sum + x, 0) / xs.length, z: zs.reduce((sum, z) => sum + z, 0) / zs.length }
  const labelAt = (a: Point, b: Point) => {
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, length = Math.max(dist(a, b), 1e-6)
    let normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length }
    if (normal.x * (mid.x - centre.x) + normal.z * (mid.z - centre.z) < 0) normal = { x: -normal.x, z: -normal.z }
    const offset = size * (0.06 + Math.abs(normal.x) * 0.08)
    return { x: mid.x + normal.x * offset, z: mid.z + normal.z * offset }
  }
  return <svg className="measure-plan" viewBox={`${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`} role="img" aria-label={label}>
    {polygon && <polygon points={polygon.map((p) => `${p.x},${p.z}`).join(' ')} fill="#e8f0eb" />}
    {segments.map(([a, b], i) => <line key={i} x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="#2f5d46" strokeWidth={size * 0.022} strokeLinecap="round" />)}
    {points.map((p, i) => <circle key={i} cx={p.x} cy={p.z} r={size * 0.018} fill="#fff" stroke="#2f5d46" strokeWidth={size * 0.01} />)}
    {segments.map(([a, b], i) => { const p = labelAt(a, b); return <text key={i} x={p.x} y={p.z} fontSize={size * 0.06} textAnchor="middle" dominantBaseline="central" fill="#1f2a24" stroke="#fff" strokeWidth={size * 0.02} paintOrder="stroke">{formatMetres(dist(a, b))}</text> })}
  </svg>
}

export default function MeasureRoom({ name, ceilingHeight, replacing, onClose, onBuild }: { name: string; ceilingHeight: number; replacing: boolean; onClose: () => void; onBuild: (project: ProjectState, summary: string) => void }) {
  const [mode, setMode] = useState<Mode>('choose')
  const [source, setSource] = useState<'manual' | 'ar'>('manual')
  const [arAvailable, setArAvailable] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<WallEntry[]>([])
  const [length, setLength] = useState('')
  const [turn, setTurn] = useState(90)
  const [closeGap, setCloseGap] = useState(false)
  const [arCorners, setArCorners] = useState<Point[]>([])
  const [live, setLive] = useState<Live>({ status: 'searching', distance: null, closing: false })
  const [straighten, setStraighten] = useState(true)
  const [height, setHeight] = useState(String(ceilingHeight))
  const [message, setMessage] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null), controlsRef = useRef<HTMLDivElement>(null), lengthRef = useRef<HTMLInputElement>(null)
  const xr = useRef<{ session: XRSession; mark: () => void; undo: () => void; finish: boolean } | null>(null)

  useEffect(() => { let active = true; arMeasureSupported().then((ok) => active && setArAvailable(ok)); return () => { active = false; xr.current?.session.end().catch(() => undefined) } }, [])
  useEffect(() => {
    const controls = controlsRef.current, block = (event: Event) => event.preventDefault()
    controls?.addEventListener('beforexrselect', block)
    return () => controls?.removeEventListener('beforexrselect', block)
  }, [])

  const parsedLength = () => Number(length.trim().replace(',', '.'))
  const addWall = (event?: FormEvent) => {
    event?.preventDefault()
    const value = parsedLength()
    if (!(value >= 0.2 && value <= 38)) { setMessage('Enter a wall length between 0.2 and 38 m.'); return false }
    if (entries.length >= MAX_CAPTURED_WALLS) { setMessage(`Measure up to ${MAX_CAPTURED_WALLS} walls per room.`); return false }
    setEntries((current) => [...current, { length: Math.round(value * 100) / 100, turn }]); setLength(''); setMessage(''); setCloseGap(false)
    lengthRef.current?.focus()
    return true
  }
  const finishManual = () => {
    const pending = length.trim() ? parsedLength() : null
    if (pending !== null && !addWall()) return
    if (entries.length + (pending === null ? 0 : 1) < 3) { setMessage('Measure at least 3 walls.'); return }
    setSource('manual'); setMode('review'); setMessage('')
  }

  const startAr = async () => {
    setMessage('')
    let session: XRSession
    try {
      session = await navigator.xr!.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlayRef.current! } })
    } catch {
      setMessage('AR could not start. Allow camera access and try again, or enter the wall lengths instead.'); return
    }
    const renderer = new WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local')
    const scene = new Scene(), camera = new PerspectiveCamera(), marks = new Group()
    const lineGeometry = new BoxGeometry(1, 0.004, 0.014), dotGeometry = new SphereGeometry(0.018, 16, 12)
    const wallMaterial = new MeshBasicMaterial({ color: '#4fd18b' }), pendingMaterial = new MeshBasicMaterial({ color: '#ffffff' })
    const reticle = new Mesh(new RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#ffffff' }))
    const pending = new Mesh(lineGeometry, pendingMaterial)
    reticle.visible = false; pending.visible = false
    scene.add(reticle, pending, marks)
    const corners: { point: Point; group: Group }[] = []
    let current: Point | null = null, closing = false, floorY: number | null = null, liveKey = '', lastLiveUpdate = -Infinity, hitSource: XRHitTestSource | undefined
    const placeLine = (mesh: Mesh, a: Point, b: Point) => {
      mesh.position.set((a.x + b.x) / 2, floorY! + 0.003, (a.z + b.z) / 2)
      mesh.scale.set(Math.max(dist(a, b), 0.001), 1, 1)
      mesh.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), 0)
    }
    const dot = (point: Point) => { const mesh = new Mesh(dotGeometry, wallMaterial); mesh.position.set(point.x, floorY!, point.z); return mesh }
    const publish = () => setArCorners(corners.map((item) => item.point))
    const finish = () => { if (!xr.current || corners.length < 3) return; xr.current.finish = true; session.end().catch(() => undefined) }
    const mark = () => {
      if (!current || floorY === null) return
      if (closing) { finish(); return }
      const last = corners.at(-1)?.point
      if (last && dist(last, current) < 0.2) { setMessage('Move at least 20 cm to the next corner before marking it.'); return }
      if (corners.length >= MAX_CAPTURED_WALLS) { setMessage(`Measure up to ${MAX_CAPTURED_WALLS} walls per room.`); return }
      const group = new Group()
      group.add(dot(current))
      if (last) { const line = new Mesh(lineGeometry, wallMaterial); placeLine(line, last, current); group.add(line) }
      marks.add(group); corners.push({ point: current, group }); setMessage(''); publish()
    }
    const undo = () => { const last = corners.pop(); if (last) { marks.remove(last.group); setMessage(''); publish() } }
    session.addEventListener('select', mark)
    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null); hitSource?.cancel(); renderer.dispose()
      lineGeometry.dispose(); dotGeometry.dispose(); reticle.geometry.dispose(); wallMaterial.dispose(); pendingMaterial.dispose()
      const finished = xr.current?.finish && corners.length >= 3
      xr.current = null
      if (finished) { setSource('ar'); setMode('review') }
      else { setArCorners([]); setMode('choose'); if (corners.length) setMessage('AR measuring ended before the room was finished. Mark at least 3 corners.') }
    })
    xr.current = { session, mark, undo, finish: false }
    setArCorners([]); setLive({ status: 'searching', distance: null, closing: false }); setMode('ar')
    try {
      hitSource = await session.requestHitTestSource?.({ space: await session.requestReferenceSpace('viewer') })
      if (!hitSource) throw new Error('Hit testing is unavailable.')
      renderer.setAnimationLoop((time, frame) => {
        const space = renderer.xr.getReferenceSpace()
        if (frame && space && !corners.length) for (const hit of frame.getHitTestResults(hitSource!)) {
          const m = hit.getPose(space)?.transform.matrix
          if (m && m[5] > 0.8) floorY = floorY === null ? m[13] : Math.min(floorY, m[13])
        }
        const view = frame && space ? frame.getViewerPose(space)?.transform.matrix : undefined
        current = view && floorY !== null ? floorPointFromRay({ x: view[12], y: view[13], z: view[14] }, { x: -view[8], y: -view[9], z: -view[10] }, floorY) : null
        closing = Boolean(current && corners.length >= 3 && dist(current, corners[0].point) < CLOSE_SNAP)
        if (closing) current = corners[0].point
        reticle.visible = Boolean(current)
        if (current) reticle.position.set(current.x, floorY!, current.z)
        const last = corners.at(-1)?.point
        pending.visible = Boolean(last && current)
        if (last && current) placeLine(pending, last, current)
        const next: Live = { status: floorY === null ? 'searching' : current ? 'floor' : 'aim-lower', distance: last && current ? dist(last, current) : null, closing }
        const key = `${next.status}:${next.closing}:${next.distance === null ? '' : Math.round(next.distance * 100)}`
        if (key !== liveKey && time - lastLiveUpdate >= 100) { liveKey = key; lastLiveUpdate = time; setLive(next) }
        renderer.render(scene, camera)
      })
      await renderer.xr.setSession(session)
    } catch {
      setMessage('This device could not start AR floor tracking. Enter the wall lengths instead.'); session.end().catch(() => undefined); return
    }
  }
  const endAr = (finish: boolean) => { if (!xr.current) return; xr.current.finish = finish; xr.current.session.end().catch(() => undefined) }

  const capture = useMemo((): { result: CaptureResult | null; error: string } => {
    if (mode !== 'review') return { result: null, error: '' }
    try { return { result: source === 'ar' ? cornersFromMeasuredWalls(wallsFromCorners(arCorners), straighten) : cornersFromEntries(entries, closeGap), error: '' } }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : 'These measurements could not be joined into a room.' } }
  }, [mode, source, arCorners, straighten, entries, closeGap])
  const built = useMemo((): { project: ProjectState | null; error: string } => {
    if (!capture.result) return { project: null, error: capture.error }
    try { return { project: projectFromCorners(capture.result.corners, { name, ceilingHeight: Number(height.replace(',', '.')) }), error: '' } }
    catch (error) { return { project: null, error: error instanceof Error ? error.message : 'These measurements could not be built.' } }
  }, [capture, name, height])
  const path = entryPath(entries), perimeter = entries.reduce((sum, entry) => sum + entry.length, 0)
  const openGap = entries.length >= 2 ? dist(path[0], path.at(-1)!) : 0
  const canAddClosingWall = mode === 'review' && source === 'manual' && !closeGap && openGap > closeTolerance(perimeter) && entries.length < MAX_CAPTURED_WALLS
  const area = built.project ? getFloorRegions(built.project.features)[0]?.area ?? 0 : 0
  const loop = (points: Point[]) => points.map((p, i): [Point, Point] => [p, points[(i + 1) % points.length]])
  const build = () => {
    if (!built.project || !capture.result) return
    const walls = capture.result.corners.length
    onBuild(built.project, `Room built from ${walls} measured walls · ${area.toFixed(1)} m². Next, add doors and windows, then furnish.`)
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Close measure dialog" />
    <div className="modal-card measure-card" role="dialog" aria-modal="true" aria-label="Measure your room">
      <div className="modal-header"><div><span className="eyebrow">One room at a time</span><h2>{mode === 'review' ? 'Check your room' : 'Measure your room'}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div>

      {mode === 'choose' && <>
        <p className="catalog-intro">Measure each wall in order as you walk around the room. We build the walls for you; then you add doors, windows and furniture.</p>
        <div className="measure-options">
          <button type="button" className="measure-option" disabled={!arAvailable} onClick={startAr}>
            <strong>Measure with your camera (AR)</strong>
            <span>{arAvailable === null ? 'Checking this device…' : arAvailable ? 'Aim at each corner where the wall meets the floor and tap, one after another. Marks stay on the floor, so furniture in the way does not matter.' : 'Not available in this browser. Camera measuring needs Chrome on an ARCore-supported Android phone.'}</span>
          </button>
          <button type="button" className="measure-option" onClick={() => { setMode('manual'); setMessage('') }}>
            <strong>Enter wall lengths</strong>
            <span>Use a tape, a laser or your phone's measuring app. Type each length and the turn at its corner.</span>
          </button>
        </div>
        {message && <p className="form-note measure-error" role="alert">{message}</p>}
        {replacing && <p className="form-note">Building replaces the current plan. You can undo it afterwards.</p>}
      </>}

      {mode === 'manual' && <>
        <PlanPreview segments={path.slice(1).map((p, i) => [path[i], p])} label="Measured walls so far" />
        <form className="measure-entry" onSubmit={addWall}>
          <label className="field-label"><span>Wall {entries.length + 1} length</span><span className="unit-input"><input ref={lengthRef} aria-label="Wall length in metres" inputMode="decimal" autoComplete="off" placeholder="e.g. 3.45" value={length} onChange={(event) => setLength(event.target.value)} /><em>m</em></span></label>
          <div className="measure-turns" role="radiogroup" aria-label="Turn at the end of this wall">
            {turns.map((option) => <button key={option.value} type="button" role="radio" aria-checked={turn === option.value} className={turn === option.value ? 'measure-turn-active' : ''} onClick={() => setTurn(option.value)}>{option.label}</button>)}
          </div>
          <button type="submit" className="secondary-button">Add wall</button>
        </form>
        {entries.length > 0 && <ol className="measure-list">{entries.map((entry, i) => <li key={i}><span>Wall {i + 1}</span><strong>{formatMetres(entry.length)}</strong><small>then {turns.find((option) => option.value === entry.turn)?.label ?? `${entry.turn}°`}</small></li>)}</ol>}
        <p className="form-note">Start in a corner and measure along the floor. Turn the way you walk: in a simple room every turn is the same. Lengths are in metres.</p>
        {message && <p className="form-note measure-error" role="alert">{message}</p>}
        <div className="modal-actions">
          {entries.length > 0 ? <button type="button" className="ghost-button" onClick={() => { setEntries((current) => current.slice(0, -1)); setCloseGap(false) }}>Remove last wall</button> : <button type="button" className="ghost-button" onClick={() => setMode('choose')}>Back</button>}
          <button type="button" className="primary-button" onClick={finishManual} disabled={entries.length + (length.trim() ? 1 : 0) < 3}>Finish room</button>
        </div>
      </>}

      {mode === 'ar' && <p className="catalog-intro" role="status">Camera measuring in progress…</p>}

      {mode === 'review' && <>
        <PlanPreview segments={capture.result ? loop(capture.result.corners) : source === 'ar' ? loop(arCorners) : path.slice(1).map((p, i) => [path[i], p])} polygon={built.project ? capture.result!.corners : undefined} label="Measured room plan" />
        {built.project && <p className="measure-summary"><strong>{capture.result!.corners.length} walls · {area.toFixed(1)} m²</strong>
          <span>{source === 'ar' ? straighten ? 'Corners within 7° of square were straightened.' : 'Corners are kept exactly as measured.' : capture.result!.adjusted ? `A ${formatMetres(capture.result!.gap)} closing gap was spread across the walls.` : closeGap ? 'A closing wall joins your last wall to the start.' : 'Your walls close exactly.'} Every wall stays editable.</span></p>}
        {source === 'ar' && <label className="measure-check"><input type="checkbox" checked={straighten} onChange={(event) => setStraighten(event.target.checked)} /> Straighten nearly square corners</label>}
        <label className="field-label"><span>Ceiling height</span><span className="unit-input"><input aria-label="Ceiling height in metres" inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} /><em>m</em></span></label>
        {built.error && <p className="form-note measure-error" role="alert">{built.error}</p>}
        {canAddClosingWall && <button type="button" className="secondary-button" onClick={() => setCloseGap(true)}>Add a closing wall ({formatMetres(openGap)})</button>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => { setMode(source === 'ar' ? 'choose' : 'manual'); setCloseGap(false) }}>{source === 'ar' ? 'Measure again' : 'Edit walls'}</button>
          <button type="button" className="primary-button" onClick={build} disabled={!built.project}>Build my room</button>
        </div>
      </>}
    </div>

    <div ref={overlayRef} className="ar-overlay" hidden={mode !== 'ar'}>
      <div className="ar-top">
        <strong>{!arCorners.length ? 'Aim at the first corner where the wall meets the floor' : live.closing ? 'Back at the first corner: tap to close the room' : `Wall ${arCorners.length}: aim at the next corner`}</strong>
        <span>{live.status === 'searching' ? 'Move your phone slowly over open floor to find it.' : live.status === 'aim-lower' ? 'Aim lower, at the floor.' : live.distance !== null ? formatMetres(live.distance) : 'Tap to start. Hidden corners work too: aim where the corner meets the floor.'}</span>
        {message && <span className="ar-message">{message}</span>}
      </div>
      <div className="ar-crosshair" aria-hidden="true" />
      <div className="ar-bottom" ref={controlsRef}>
        <PlanPreview segments={arCorners.slice(1).map((p, i): [Point, Point] => [arCorners[i], p])} label="Walls measured in AR" />
        <div className="ar-actions">
          <button type="button" className="secondary-button" onClick={() => xr.current?.undo()} disabled={!arCorners.length}>Undo</button>
          <button type="button" className="primary-button" onClick={() => xr.current?.mark()} disabled={live.status !== 'floor'}>{!arCorners.length ? 'Start here' : live.closing ? 'Close room' : 'Mark corner'}</button>
          <button type="button" className="secondary-button" onClick={() => endAr(arCorners.length >= 3)}>{arCorners.length >= 3 ? 'Finish room' : 'Exit'}</button>
        </div>
      </div>
    </div>
  </div>
}
