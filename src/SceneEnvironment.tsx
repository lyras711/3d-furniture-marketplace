import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SurfaceMaterial from './SurfaceMaterial'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges, Environment, Grid, Html, Line } from '@react-three/drei'
import { DoubleSide, Path, Plane, Raycaster, Shape, Vector2, Vector3 } from 'three'
import { activeTouchCount, beyondSlop, cancelOnMultiTouch, isDoubleTap, TAP_MAX_TRAVEL_PX, type Tap } from './gestures'
import { doorSwingSign, fitsFloor, floorColors, openingStyle, snapWallDrag, getFloorRegions, placeObject, pointInPolygon, productById, snapBuildPoint, wallColors, wallEndpoints, wallFromPoints, wallThickness, type FloorRegion, type Point, type ProjectState, type RoomFeature } from './editor'

const floor = new Plane(new Vector3(0, 1, 0), 0)
const dragType = 'application/x-forma-product'
export type EditorLightingMode = 'default' | 'day' | 'night'
export function FloorSurface({ region, color, finish, elevation = -0.01, ceiling = false }: { region: FloorRegion; color: string; finish?: string; elevation?: number; ceiling?: boolean }) {
  const shape = useMemo(() => {
    const shape = new Shape(region.points.map((p) => new Vector2(p.x, -p.z)))
    shape.holes = region.holes.map((hole) => new Path(hole.map((p) => new Vector2(p.x, -p.z))))
    return shape
  }, [region])
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, elevation, 0]} receiveShadow castShadow={ceiling} raycast={() => null}><shapeGeometry args={[shape]} onUpdate={(geometry) => { const uv = geometry.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, geometry.getAttribute('position').getX(i) / 2, geometry.getAttribute('position').getY(i) / 2); uv.needsUpdate = true }} />{finish?.includes('oak') ? <SurfaceMaterial kind="floor" color={finish === 'Pale oak' ? '#fff8ec' : '#e4c9a7'} /> : <meshStandardMaterial color={color} side={DoubleSide} roughness={ceiling ? 0.85 : 0.7} />}</mesh>
}

type Glass = { color: string; transmission: number; roughness: number; emissive: string; emissiveIntensity: number }
const planLine = (points: [number, number][], y = 0.035) => points.map(([x, z]) => [x, y, z] as [number, number, number])
/** One door or window in wall-local space (X along the wall, Z along its normal). `swing` is the local Z side a door leaf opens into. */
function OpeningBody({ feature: f, low, y, openingHeight, thickness, selected, swing, glass }: { feature: RoomFeature; low: boolean; y: number; openingHeight: number; thickness: number; selected: boolean; swing: number; glass: Glass }) {
  const style = openingStyle(f), w = f.width, door = f.type === 'door', hingeX = (f.hinge === 'right' ? 1 : -1) * w / 2
  const frameColor = door ? '#ede5d7' : '#30362f'
  const edges = selected && <Edges color="#4d7858" lineWidth={2} />
  const arc = (pivot: number, radius: number, toward: number) => planLine(Array.from({ length: 25 }, (_, i) => [pivot + toward * Math.cos(i / 24 * Math.PI / 2) * radius, swing * Math.sin(i / 24 * Math.PI / 2) * radius]))
  if (low) return <>
    <mesh position={[0, y, 0]} receiveShadow><boxGeometry args={[w, openingHeight, thickness]} /><meshStandardMaterial color={door ? style === 'opening' ? '#e3d8c5' : '#c4aa88' : '#a5c3c5'} />{edges}</mesh>
    {door && style === 'hinged' && <><Line points={arc(hingeX, w, -Math.sign(hingeX))} color="#a89679" lineWidth={1} dashed dashSize={0.08} gapSize={0.05} raycast={() => null} /><Line points={planLine([[hingeX, 0], [hingeX, swing * w]])} color="#8d7a5c" lineWidth={1.5} raycast={() => null} /></>}
    {door && style === 'double' && [-1, 1].map((side) => <group key={side}><Line points={arc(side * w / 2, w / 2, -side)} color="#a89679" lineWidth={1} dashed dashSize={0.06} gapSize={0.04} raycast={() => null} /><Line points={planLine([[side * w / 2, 0], [side * w / 2, swing * w / 2]])} color="#8d7a5c" lineWidth={1.5} raycast={() => null} /></group>)}
    {door && style === 'sliding' && <><Line points={planLine([[-w / 2, -0.025], [0.06, -0.025]], 0.11)} color="#6f5f45" lineWidth={2} raycast={() => null} /><Line points={planLine([[-0.06, 0.025], [w / 2, 0.025]], 0.11)} color="#6f5f45" lineWidth={2} raycast={() => null} /></>}
    {!door && style === 'balcony' && <Line points={planLine([[0, -thickness / 2], [0, thickness / 2]], 0.11)} color="#57787b" lineWidth={1.5} raycast={() => null} />}
  </>
  const leaf = (x: number, width: number, z = 0, depth = 0.045) => <mesh key={`${x}-${z}`} position={[x, y, z]} castShadow receiveShadow><boxGeometry args={[width, openingHeight - 0.04, depth]} /><SurfaceMaterial kind="oak" color="#d3b996" />{edges}</mesh>
  const handle = (x: number) => [-1, 1].map((side) => <mesh key={`${x}-${side}`} position={[x, Math.min(1, f.height * 0.55), side * 0.045]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.012, 0.012, 0.13, 16]} /><meshStandardMaterial color="#bca171" roughness={0.25} metalness={0.85} /></mesh>)
  const posts = door ? [-1, 1] : style === 'fixed' ? [-1, 1] : [-1, 0, 1]
  return <>
    {door ? <>
      {style === 'hinged' && <>{leaf(0, w - 0.05)}{handle(-Math.sign(hingeX) * w * 0.34)}</>}
      {style === 'double' && <>{[-1, 1].map((side) => leaf(side * w / 4, w / 2 - 0.04))}{handle(-0.07)}{handle(0.07)}</>}
      {style === 'sliding' && [-1, 1].map((side) => <group key={side}>{leaf(side * w / 4, w / 2 + 0.04, side * 0.026, 0.035)}<mesh position={[side * 0.12, Math.min(1, f.height * 0.5), side * 0.056]} castShadow><boxGeometry args={[0.02, 0.32, 0.02]} /><meshStandardMaterial color="#8d8a82" roughness={0.3} metalness={0.8} /></mesh></group>)}
      {style === 'opening' && <mesh position={[0, y, 0]}><planeGeometry args={[w, openingHeight]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />{edges}</mesh>}
    </> : <mesh position={[0, y, 0]} receiveShadow><planeGeometry args={[w, openingHeight]} /><meshPhysicalMaterial color={glass.color} transmission={glass.transmission} thickness={0} ior={1.5} roughness={glass.roughness} emissive={glass.emissive} emissiveIntensity={glass.emissiveIntensity} side={DoubleSide} />{edges}</mesh>}
    {posts.map((i) => <mesh key={i} position={[i * (w / 2 - 0.025), y, 0]} castShadow receiveShadow><boxGeometry args={[0.045, openingHeight, thickness + 0.025]} /><meshStandardMaterial color={frameColor} roughness={0.38} metalness={door ? 0 : 0.45} /></mesh>)}
    {[-1, 1].map((i) => <mesh key={i} position={[0, y + i * (openingHeight / 2 - 0.02), 0]} castShadow receiveShadow><boxGeometry args={[w, 0.04, thickness + 0.025]} /><meshStandardMaterial color={frameColor} roughness={0.38} /></mesh>)}
    {!door && style !== 'balcony' && <mesh position={[0, y - openingHeight / 2 - 0.025, 0]} castShadow receiveShadow><boxGeometry args={[w + 0.08, 0.045, thickness + 0.11]} /><meshStandardMaterial color="#d8cfbb" roughness={0.35} /></mesh>}
  </>
}

export function Architecture({ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onMoveOpening, onDragStart, onDragEnd, onDragCancel = onDragEnd, onErase, onEditLength, lightingMode = 'default' }: {
  project: ProjectState; viewMode: '2d' | '3d'; cutaway: boolean; selectedId: string | null; tool: string
  onErase?: (id: string) => void; onEditLength?: (id: string) => void
  onSelect: (id: string, point?: Point) => void; onPlace: (type: 'door' | 'window', x: number, z: number) => void
  onMoveEndpoint: (id: string, previous: Point, next: Point) => void
  onMoveOpening: (id: string, wallOffset: number) => void
  onDragStart: (id: string) => void; onDragEnd: () => void; onDragCancel?: () => void
  lightingMode?: EditorLightingMode
}) {
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  return <>{project.features.filter((f) => f.type === 'wall').map((wall) => <WallObject key={wall.id} {...{ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onMoveOpening, onDragStart, onDragEnd, onDragCancel, onErase, onEditLength, lightingMode, regions }} wall={wall} />)}</>
}
function WallObject({ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onMoveOpening, onDragStart, onDragEnd, onDragCancel = onDragEnd, onErase, onEditLength, lightingMode = 'default', wall, regions }: Parameters<typeof Architecture>[0] & { wall: RoomFeature; regions: FloorRegion[] }) {
  const { camera, controls } = useThree()
  const [front, setFront] = useState(false)
  const drag = useRef<Point | null>(null)
  const openingDrag = useRef<string | null>(null)
  // Touch drags wait for the slop and stop when a second finger lands, so pinch-zoom never drags architecture.
  const touchDrag = useRef<{ start: { x: number; y: number }; moved: boolean; release: () => void } | null>(null)
  const setControls = (enabled: boolean) => { if (controls) (controls as unknown as { enabled: boolean }).enabled = enabled }
  const beginTouchDrag = (event: ThreeEvent<PointerEvent>) => {
    const target = event.target as Element, pointerId = event.pointerId, touch = event.pointerType === 'touch'
    touchDrag.current = { start: { x: event.clientX, y: event.clientY }, moved: !touch, release: touch ? cancelOnMultiTouch(() => {
      drag.current = null; openingDrag.current = null; touchDrag.current = null
      target.releasePointerCapture?.(pointerId)
      setControls(true)
      onDragCancel()
    }) : () => undefined }
  }
  const dragReady = (event: ThreeEvent<PointerEvent>) => {
    const gesture = touchDrag.current
    return !gesture || gesture.moved || (gesture.moved = beyondSlop(gesture.start, { x: event.clientX, y: event.clientY }))
  }
  const endTouchDrag = () => { touchDrag.current?.release(); touchDrag.current = null }
  const selected = selectedId === wall.id
  const thickness = wallThickness(wall)
  const openings = project.features.filter((f) => f.wallId === wall.id)
  const outside = useMemo(() => {
    const nx = Math.sin(wall.rotation), nz = Math.cos(wall.rotation)
    const inside = (side: number) => regions.some((r) => pointInPolygon({ x: wall.x + nx * side * 0.15, z: wall.z + nz * side * 0.15 }, r.points))
    return inside(1) && !inside(-1) ? -1 : inside(-1) && !inside(1) ? 1 : 0
  }, [regions, wall.x, wall.z, wall.rotation])
  useFrame(() => {
    const nx = Math.sin(wall.rotation), nz = Math.cos(wall.rotation)
    const inside = (side: number) => regions.some((r) => pointInPolygon({ x: wall.x + nx * side * 0.15, z: wall.z + nz * side * 0.15 }, r.points))
    const direction = inside(1) && !inside(-1) ? -1 : inside(-1) && !inside(1) ? 1 : 0
    const next = direction !== 0 && direction * (nx * (camera.position.x - wall.x) + nz * (camera.position.z - wall.z)) > 0
    if (next !== front) setFront(next)
  })
  const plan = viewMode === '2d', height = plan || (cutaway && front) ? 0.1 : wall.height
  const low = height < 0.2
  const xs = [...new Set([-wall.width / 2, wall.width / 2, ...openings.flatMap((f) => [(f.wallOffset || 0) - f.width / 2, (f.wallOffset || 0) + f.width / 2])])].sort((a, b) => a - b)
  const ys = [...new Set([0, height, ...openings.flatMap((f) => [Math.min(height, f.sillHeight || 0), Math.min(height, (f.sillHeight || 0) + f.height)])])].sort((a, b) => a - b)
  const click = (event: ThreeEvent<MouseEvent>, id: string) => {
    if (GRID_TOOLS.includes(tool)) return
    event.stopPropagation()
    if (event.delta > TAP_MAX_TRAVEL_PX) return
    if (tool === 'erase') { onErase?.(id); return }
    if (tool === 'door' || tool === 'window') onPlace(tool, event.point.x, event.point.z)
    else onSelect(id, { x: event.point.x, z: event.point.z })
  }
  const openingOffset = (event: ThreeEvent<PointerEvent>) => {
    const point = event.ray.intersectPlane(floor, new Vector3())
    return point ? (point.x - wall.x) * Math.cos(wall.rotation) - (point.z - wall.z) * Math.sin(wall.rotation) : null
  }
  const finish = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    event.stopPropagation(); drag.current = null; endTouchDrag()
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    onDragEnd()
  }
  const finishOpening = (event: ThreeEvent<PointerEvent>) => {
    if (!openingDrag.current) return
    event.stopPropagation(); openingDrag.current = null; endTouchDrag()
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    onDragEnd()
  }
  return <group position={[wall.x, 0, wall.z]} rotation={[0, wall.rotation, 0]}>
    {xs.slice(0, -1).flatMap((left, i) => ys.slice(0, -1).map((bottom, j) => {
      const right = xs[i + 1], top = ys[j + 1], x = (left + right) / 2, y = (bottom + top) / 2
      if (openings.some((f) => Math.abs(x - (f.wallOffset || 0)) < f.width / 2 && (low || (y >= (f.sillHeight || 0) && y < (f.sillHeight || 0) + f.height)))) return null
      return <mesh key={`${i}-${j}`} position={[x, y, 0]} castShadow={!plan} receiveShadow onClick={(event) => click(event, wall.id)}>
        <boxGeometry args={[right - left, top - bottom, thickness]} /><meshStandardMaterial color={selected ? '#93af97' : plan ? '#7e8878' : wallColors[project.wallMaterial]} roughness={0.9} />{selected && <Edges color="#58765d" />}
      </mesh>
    }))}
    {openings.map((f) => {
      const openingHeight = low ? 0.08 : f.height, y = low ? 0.065 : (f.sillHeight || 0) + openingHeight / 2
      const windowColor = lightingMode === 'night' ? '#142238' : lightingMode === 'day' ? '#eaf8ff' : '#f5faf7'
      const windowTransmission = lightingMode === 'night' ? 0.04 : lightingMode === 'day' ? 0.82 : 0.98
      const windowRoughness = lightingMode === 'night' ? 0.28 : lightingMode === 'day' ? 0.08 : 0.035
      const windowEmissive = lightingMode === 'night' ? '#0c1423' : lightingMode === 'day' ? '#dff4ff' : '#000000'
      const windowEmissiveIntensity = lightingMode === 'night' ? 0.04 : lightingMode === 'day' ? 0.12 : 0
      return <group key={f.id} position={[f.wallOffset || 0, 0, 0]} onClick={(event) => click(event, f.id)}
        onPointerDown={(event) => {
          if (event.button !== 0 || tool !== 'select') return
          if (event.pointerType === 'touch' && (selectedId !== f.id || activeTouchCount() > 1)) return
          const offset = openingOffset(event)
          if (offset === null) return
          event.stopPropagation()
          openingDrag.current = f.id
          beginTouchDrag(event)
          ;(event.target as Element).setPointerCapture?.(event.pointerId)
          setControls(false)
          onSelect(f.id)
          onDragStart(f.id)
        }}
        onPointerMove={(event) => {
          if (openingDrag.current !== f.id) return
          event.stopPropagation()
          if (!dragReady(event)) return
          const offset = openingOffset(event)
          if (offset !== null) onMoveOpening(f.id, offset)
        }} onPointerUp={finishOpening} onPointerCancel={finishOpening}>
        <OpeningBody feature={f} low={low} y={y} openingHeight={openingHeight} thickness={thickness} selected={selectedId === f.id} swing={f.type === 'door' ? doorSwingSign(f, wall, regions) : 1} glass={{ color: windowColor, transmission: windowTransmission, roughness: windowRoughness, emissive: windowEmissive, emissiveIntensity: windowEmissiveIntensity }} />
      </group>
    })}
    {!low && xs.slice(0, -1).map((left, i) => {
      const right = xs[i + 1], x = (left + right) / 2
      if (openings.some((f) => (f.sillHeight || 0) < 0.1 && Math.abs(x - (f.wallOffset || 0)) < f.width / 2)) return null
      return [-1, 1].map((side) => <mesh key={`${i}-${side}`} position={[x, 0.055, side * (thickness / 2 + 0.013)]} castShadow receiveShadow><boxGeometry args={[right - left, 0.11, 0.026]} /><meshStandardMaterial color="#e6dfd2" roughness={0.5} /></mesh>)
    })}
    {selected && <Html center position={[0, height + 0.15, 0]} style={{ pointerEvents: onEditLength ? 'auto' : 'none' }}>{onEditLength ? <button type="button" className="dimension-tag wall-length-edit" aria-label={`Change wall length, now ${wall.width.toFixed(2)} m`} onClick={() => onEditLength(wall.id)}>{wall.width.toFixed(2)} m ✎</button> : <span className="dimension-tag">{wall.width.toFixed(2)} m</span>}</Html>}
    {plan && !selected && wall.width >= 0.6 && <Html center position={[0, height + 0.15, outside * (thickness / 2 + 0.46)]} style={{ pointerEvents: onEditLength && tool === 'select' ? 'auto' : 'none' }}>{onEditLength && tool === 'select' ? <button type="button" className="wall-length-tag wall-length-edit" aria-label={`Change wall length, now ${wall.width.toFixed(2)} m`} onClick={() => onEditLength(wall.id)}>{wall.width.toFixed(2)} m</button> : <span className="wall-length-tag">{wall.width.toFixed(2)} m</span>}</Html>}
    {selected && tool === 'select' && [-1, 1].map((side, index) => <mesh key={side} position={[side * wall.width / 2, plan ? 0.16 : height + 0.08, 0]}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.pointerType === 'touch' && activeTouchCount() > 1)) return
        event.stopPropagation(); drag.current = wallEndpoints(wall)[index]
        beginTouchDrag(event)
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        setControls(false)
        onDragStart(wall.id)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        event.stopPropagation()
        if (!dragReady(event)) return
        const p = event.ray.intersectPlane(floor, new Vector3())
        if (!p) return
        const next = snapBuildPoint({ x: p.x, z: p.z }, project, wall.id)
        if (project.features.filter((f) => f.type === 'wall').some((f) => { const ends = wallEndpoints(f); return ends.some((end, i) => Math.hypot(end.x - drag.current!.x, end.z - drag.current!.z) < 0.0001 && Math.hypot(ends[1 - i].x - next.x, ends[1 - i].z - next.z) < 0.25) })) return
        onMoveEndpoint(wall.id, drag.current, next)
        drag.current = next
      }} onPointerUp={finish} onPointerCancel={finish}>
      <sphereGeometry args={[0.18, 16, 12]} /><meshBasicMaterial color="#5a8161" />
    </mesh>)}
  </group>
}

export type BuildAction = { tool: 'wall' | 'room' | 'erase'; a: Point; b: Point } | { tool: 'sketch'; points: Point[] }
export const BUILD_TOOLS = ['wall', 'room', 'erase', 'sketch']
/** Tools that draw on the build grid (the plan view shows the whole grid while they are active). */
export const GRID_TOOLS = ['wall', 'room', 'sketch']

export default function SceneEnvironment({ project, viewMode, gridVisible, tool, snap, wallSnap, lightingMode, onClear, onPlace, onDrop, onBuild, sketch = [], onAddAt }: {
  project: ProjectState; viewMode: '2d' | '3d'; gridVisible: boolean; tool: string; snap: boolean; wallSnap: boolean; lightingMode: EditorLightingMode
  onClear: () => void; onPlace: (type: 'wall' | 'door' | 'window', x: number, z: number) => void
  onDrop: (id: string, x: number, z: number) => void
  onBuild: (action: BuildAction) => void
  sketch?: Point[][]
  onAddAt?: (x: number, z: number) => void
}) {
  const lastTap = useRef<Tap | null>(null)
  const { camera, gl, invalidate } = useThree()
  const readyFrames = useRef(0)
  useFrame(() => {
    if (readyFrames.current >= 2) return
    readyFrames.current += 1
    if (readyFrames.current === 2) gl.domElement.dataset.sceneReady = 'true'
    else invalidate()
  })
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  const editor3d = viewMode === '3d', day3d = editor3d && lightingMode === 'day', exterior3d = editor3d && lightingMode === 'default'
  const [ghost, setGhost] = useState<{ id: string; x: number; z: number; valid: boolean } | null>(null)
  // One press–drag–release gesture per wall, room box, erase stroke or sketch stroke (Sims-style), in plan or 3D view.
  const building = BUILD_TOOLS.includes(tool)
  const gesture = useRef<{ id: number; element: Element; start: Point; end: Point; points: Point[]; screen: { x: number; y: number }; moved: boolean; release: () => void } | null>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point; points: Point[] } | null>(null)
  const current = useRef({ project, snap, wallSnap, onDrop, regions })
  current.current = { project, snap, wallSnap, onDrop, regions }
  useEffect(() => {
    const canvas = gl.domElement, ray = new Raycaster()
    const locate = (event: DragEvent) => {
      const rect = canvas.getBoundingClientRect()
      ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      return ray.ray.intersectPlane(floor, new Vector3())
    }
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(dragType)) return
      event.preventDefault()
      const id = canvas.closest('.canvas-frame')?.getAttribute('data-drag-product'), point = locate(event)
      if (id && point) {
        const p = placeObject({ id: '', productId: id, x: point.x, z: point.z, rotation: 0 }, current.current.project, current.current.snap, current.current.wallSnap)
        const valid = fitsFloor(p, current.current.project, current.current.regions)
        event.dataTransfer.dropEffect = 'copy'
        setGhost({ id, x: p.x, z: p.z, valid })
      }
      invalidate()
    }
    const leave = () => { setGhost(null); invalidate() }
    const drop = (event: DragEvent) => {
      const id = event.dataTransfer?.getData(dragType)
      if (!id || !productById.has(id)) return
      event.preventDefault()
      const point = locate(event)
      if (point) current.current.onDrop(id, point.x, point.z)
      leave()
    }
    canvas.addEventListener('dragover', over); canvas.addEventListener('dragleave', leave); canvas.addEventListener('drop', drop); window.addEventListener('dragend', leave)
    return () => { canvas.removeEventListener('dragover', over); canvas.removeEventListener('dragleave', leave); canvas.removeEventListener('drop', drop); window.removeEventListener('dragend', leave) }
  }, [camera, gl, invalidate])
  const stopGesture = () => {
    const g = gesture.current
    if (!g) return
    g.release(); g.element.releasePointerCapture?.(g.id)
    gesture.current = null; setPreview(null)
  }
  useEffect(() => {
    if (!building) stopGesture()
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') stopGesture() }
    window.addEventListener('keydown', cancel); window.addEventListener('blur', stopGesture)
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', stopGesture) }
  }, [building])
  const floorPoint = (event: ThreeEvent<PointerEvent>) => { const p = event.ray.intersectPlane(floor, new Vector3()); return p ? { x: p.x, z: p.z } : null }
  const endFor = (start: Point, raw: Point) => tool === 'sketch' ? raw : tool === 'room' ? snapBuildPoint(raw, project) : snapWallDrag(start, raw, project)
  const previewWall = preview && tool === 'wall' && Math.hypot(preview.end.x - preview.start.x, preview.end.z - preview.start.z) >= 0.25 ? wallFromPoints('__preview__', preview.start, preview.end, project.ceilingHeight) : null
  const previewClosesRoom = previewWall ? getFloorRegions([...project.features, previewWall]).length > regions.length : false
  const ghostWall = (a: Point, b: Point, color: string, key: string | number) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (viewMode !== '3d' || length < 0.05) return null
    return <mesh key={key} position={[(a.x + b.x) / 2, project.ceilingHeight / 2, (a.z + b.z) / 2]} rotation={[0, -Math.atan2(b.z - a.z, b.x - a.x), 0]} raycast={() => null}><boxGeometry args={[length, project.ceilingHeight, 0.12]} /><meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} /></mesh>
  }
  const plan = (points: Point[], color: string, width = 6) => <Line points={points.map((p) => [p.x, 0.14, p.z] as [number, number, number])} color={color} lineWidth={width} raycast={() => null} />
  const previewNode = preview && building && (() => {
    const { start, end, points } = preview, mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 }
    const tag = (text: string, at: Point = mid) => <Html center position={[at.x, viewMode === '3d' ? project.ceilingHeight + 0.25 : 0.3, at.z]} style={{ pointerEvents: 'none' }}><span className="dimension-tag">{text}</span></Html>
    if (tool === 'sketch') return plan(points, '#2f5d46', 4)
    if (tool === 'room') {
      const corners = [start, { x: end.x, z: start.z }, end, { x: start.x, z: end.z }]
      return <>{plan([...corners, start], '#557e61')}{corners.map((p, i) => ghostWall(p, corners[(i + 1) % 4], '#7fa98f', i))}{Math.abs(end.x - start.x) >= 0.25 && Math.abs(end.z - start.z) >= 0.25 && tag(`${Math.abs(end.x - start.x).toFixed(2)} × ${Math.abs(end.z - start.z).toFixed(2)} m`)}</>
    }
    const length = Math.hypot(end.x - start.x, end.z - start.z), erase = tool === 'erase', color = erase ? '#c0533f' : previewClosesRoom ? '#32804c' : '#557e61'
    return <>{plan([start, end], color)}{ghostWall(start, end, erase ? '#d47a68' : '#7fa98f', 'wall')}<mesh position={[end.x, 0.16, end.z]} raycast={() => null}><sphereGeometry args={[0.1, 12, 8]} /><meshBasicMaterial color={color} /></mesh>{length >= 0.25 && tag(erase ? `Remove ${length.toFixed(2)} m` : `${length.toFixed(2)} m${previewClosesRoom ? ' · Room closes' : ''}`)}</>
  })()
  return <>
    <color attach="background" args={[editor3d ? '#e8e4d9' : '#f4f3ef']} />
    {exterior3d && <Suspense fallback={null}><Environment files="/materials/forest.hdr" environmentIntensity={day3d ? 0.65 : 0.45} /></Suspense>}
    <ambientLight intensity={!editor3d ? 1.4 : exterior3d ? 0.2 : 0} />
    <hemisphereLight args={['#fff8ed', '#c5c9c3', !editor3d ? 1 : exterior3d ? 0.55 : 0]} />
    <directionalLight castShadow={exterior3d} position={[3, 9, 5]} intensity={!editor3d ? 2.3 : exterior3d ? 3.2 : 0} color={day3d ? '#fff4dc' : '#ffffff'} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.025} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
    {editor3d && lightingMode !== 'night' && project.features.filter((feature) => feature.type === 'window').map((feature) => {
      const nx = Math.sin(feature.rotation), nz = Math.cos(feature.rotation)
      const parent = project.features.find((wall) => wall.id === feature.wallId), offset = (parent ? wallThickness(parent) : 0.12) / 2 + 0.03
      const inside = regions.some((region) => pointInPolygon({ x: feature.x + nx * 0.2, z: feature.z + nz * 0.2 }, region.points)) ? 1 : -1
      return <rectAreaLight key={feature.id} position={[feature.x + nx * inside * offset, (feature.sillHeight || 0) + feature.height / 2, feature.z + nz * inside * offset]} rotation={[0, feature.rotation + (inside === 1 ? Math.PI : 0), 0]} width={feature.width * 0.9} height={feature.height * 0.9} intensity={day3d ? 30 : 2.5} color="#ffedcf" />
    })}
    <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow
      onClick={(event) => {
        if (tool !== 'select' && tool !== 'door' && tool !== 'window') return
        event.stopPropagation()
        if (event.delta > TAP_MAX_TRAVEL_PX) return
        if (tool !== 'select') { onPlace(tool, event.point.x, event.point.z); return }
        const tap = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY, time: event.nativeEvent.timeStamp }
        if (onAddAt && isDoubleTap(lastTap.current, tap)) { lastTap.current = null; onAddAt(event.point.x, event.point.z); return }
        lastTap.current = tap
        onClear()
      }}
      onPointerDown={(event) => {
        if (!building || event.button !== 0 || (event.pointerType === 'touch' && activeTouchCount() > 1)) return
        const raw = floorPoint(event)
        if (!raw) return
        event.stopPropagation()
        const start = tool === 'sketch' ? raw : snapBuildPoint(raw, project), element = event.target as Element, id = event.pointerId
        // A second finger means the user is zooming or orbiting: drop this stroke.
        const release = event.pointerType === 'touch' ? cancelOnMultiTouch(stopGesture) : () => undefined
        element.setPointerCapture?.(id)
        gesture.current = { id, element, start, end: start, points: [start], screen: { x: event.clientX, y: event.clientY }, moved: false, release }
        setPreview({ start, end: start, points: [start] })
      }}
      onPointerMove={(event) => {
        const g = gesture.current
        if (!g || g.id !== event.pointerId) return
        event.stopPropagation()
        const raw = floorPoint(event)
        if (!raw) return
        g.moved ||= beyondSlop(g.screen, { x: event.clientX, y: event.clientY })
        g.end = endFor(g.start, raw)
        const last = g.points[g.points.length - 1]
        if (tool === 'sketch' && Math.hypot(raw.x - last.x, raw.z - last.z) > 0.04) g.points = [...g.points, raw]
        setPreview({ start: g.start, end: g.end, points: g.points })
      }}
      onPointerUp={(event) => {
        const g = gesture.current
        if (!g || g.id !== event.pointerId) return
        event.stopPropagation()
        stopGesture()
        if (tool === 'sketch') { if (g.points.length > 2) onBuild({ tool: 'sketch', points: g.points }) }
        else if (g.moved && (tool === 'wall' || tool === 'room' || tool === 'erase')) onBuild({ tool, a: g.start, b: g.end })
      }} onPointerCancel={stopGesture}>
      <planeGeometry args={[project.width, project.length]} /><meshStandardMaterial color="#eeeee7" roughness={1} />
    </mesh>
    {regions.map((region) => <FloorSurface key={region.id} region={region} color={floorColors[project.floorMaterial]} finish={viewMode === '3d' ? project.floorMaterial : undefined} />)}
    {viewMode === '2d' && project.roomLabels?.map((label) => <Html key={label.id} center position={[label.x, 0.12, label.z]} style={{ pointerEvents: 'none' }}><span className="room-name-tag">{label.name}</span></Html>)}
    {(gridVisible || building || !regions.length) && <Grid position={[0, 0.005, 0]} args={[project.width, project.length]} cellSize={0.25} sectionSize={1} cellThickness={0.5} sectionThickness={0.9} cellColor="#d0d4c8" sectionColor="#adb8a5" fadeDistance={70} fadeStrength={1} raycast={() => null} />}
    {previewNode}
    {sketch.map((stroke, i) => <group key={i}>{plan(stroke, '#557e61', 4)}</group>)}
    {ghost && (() => { const p = productById.get(ghost.id)!; return <group position={[ghost.x, 0.035, ghost.z]}><mesh raycast={() => null}><boxGeometry args={[p.width / 100, 0.025, p.depth / 100]} /><meshBasicMaterial color={ghost.valid ? '#729982' : '#bd7868'} transparent opacity={0.5} /></mesh><Html center position={[0, 0.4, 0]} style={{ pointerEvents: 'none' }}><span className="dimension-tag">{ghost.valid ? `Release to place · ${p.width} × ${p.depth} cm` : 'Place inside a closed room'}</span></Html></group> })()}
  </>
}
