import { useEffect, useMemo, useRef, useState } from 'react'
import SurfaceMaterial from './SurfaceMaterial'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges, Grid, Html, Line } from '@react-three/drei'
import { DoubleSide, Path, Plane, Raycaster, Shape, Vector2, Vector3 } from 'three'
import { fitsFloor, floorColors, getFloorRegions, placeObject, pointInPolygon, productById, snapBuildPoint, wallColors, wallEndpoints, type FloorRegion, type Point, type ProjectState, type RoomFeature } from './editor'

const floor = new Plane(new Vector3(0, 1, 0), 0)
const dragType = 'application/x-forma-product'
export function FloorSurface({ region, color, finish, elevation = -0.01, ceiling = false }: { region: FloorRegion; color: string; finish?: string; elevation?: number; ceiling?: boolean }) {
  const shape = useMemo(() => {
    const shape = new Shape(region.points.map((p) => new Vector2(p.x, -p.z)))
    shape.holes = region.holes.map((hole) => new Path(hole.map((p) => new Vector2(p.x, -p.z))))
    return shape
  }, [region])
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, elevation, 0]} receiveShadow castShadow={ceiling} raycast={() => null}><shapeGeometry args={[shape]} onUpdate={(geometry) => { const uv = geometry.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, geometry.getAttribute('position').getX(i) / 2, geometry.getAttribute('position').getY(i) / 2); uv.needsUpdate = true }} />{finish?.includes('oak') ? <SurfaceMaterial kind="floor" color={finish === 'Pale oak' ? '#fff8ec' : '#e4c9a7'} /> : <meshStandardMaterial color={color} side={DoubleSide} roughness={ceiling ? 0.85 : 0.7} />}</mesh>
}

export function Architecture({ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onDragStart, onDragEnd }: {
  project: ProjectState; viewMode: '2d' | '3d'; cutaway: boolean; selectedId: string | null; tool: string
  onSelect: (id: string) => void; onPlace: (type: 'door' | 'window', x: number, z: number) => void
  onMoveEndpoint: (id: string, previous: Point, next: Point) => void
  onDragStart: (id: string) => void; onDragEnd: () => void
}) {
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  return <>{project.features.filter((f) => f.type === 'wall').map((wall) => <WallObject key={wall.id} {...{ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onDragStart, onDragEnd, regions }} wall={wall} />)}</>
}
function WallObject({ project, viewMode, cutaway, selectedId, tool, onSelect, onPlace, onMoveEndpoint, onDragStart, onDragEnd, wall, regions }: Parameters<typeof Architecture>[0] & { wall: RoomFeature; regions: FloorRegion[] }) {
  const { camera, controls } = useThree()
  const [front, setFront] = useState(false)
  const drag = useRef<Point | null>(null)
  const selected = selectedId === wall.id
  const openings = project.features.filter((f) => f.wallId === wall.id)
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
    if (tool === 'wall') return
    event.stopPropagation()
    if (tool === 'door' || tool === 'window') onPlace(tool, event.point.x, event.point.z)
    else onSelect(id)
  }
  const finish = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    event.stopPropagation(); drag.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    onDragEnd()
  }
  return <group position={[wall.x, 0, wall.z]} rotation={[0, wall.rotation, 0]}>
    {xs.slice(0, -1).flatMap((left, i) => ys.slice(0, -1).map((bottom, j) => {
      const right = xs[i + 1], top = ys[j + 1], x = (left + right) / 2, y = (bottom + top) / 2
      if (openings.some((f) => Math.abs(x - (f.wallOffset || 0)) < f.width / 2 && (low || (y >= (f.sillHeight || 0) && y < (f.sillHeight || 0) + f.height)))) return null
      return <mesh key={`${i}-${j}`} position={[x, y, 0]} castShadow={!plan} receiveShadow onClick={(event) => click(event, wall.id)}>
        <boxGeometry args={[right - left, top - bottom, 0.12]} /><meshStandardMaterial color={selected ? '#93af97' : plan ? '#7e8878' : wallColors[project.wallMaterial]} roughness={0.9} />{selected && <Edges color="#58765d" />}
      </mesh>
    }))}
    {openings.map((f) => {
      const openingHeight = low ? 0.08 : f.height, y = low ? 0.065 : (f.sillHeight || 0) + openingHeight / 2
      return <group key={f.id} position={[f.wallOffset || 0, 0, 0]} onClick={(event) => click(event, f.id)}>
        <mesh position={[0, y, 0]} castShadow={f.type === 'door'} receiveShadow>{f.type === 'window' && !low ? <planeGeometry args={[f.width, openingHeight]} /> : <boxGeometry args={[f.width, openingHeight, 0.045]} />}{f.type === 'window' && !low ? <meshPhysicalMaterial color="#f5faf7" transmission={0.98} thickness={0} ior={1.5} roughness={0.035} side={DoubleSide} /> : low ? <meshStandardMaterial color={f.type === 'window' ? '#a5c3c5' : '#c4aa88'} /> : <SurfaceMaterial kind="oak" color="#d3b996" />}{selectedId === f.id && <Edges color="#4d7858" lineWidth={2} />}</mesh>
        {!low && <>
          {(f.type === 'window' ? [-1, 0, 1] : [-1, 1]).map((i) => <mesh key={i} position={[i * (f.width / 2 - 0.025), y, 0]} castShadow receiveShadow><boxGeometry args={[0.045, openingHeight, 0.145]} /><meshStandardMaterial color={f.type === 'window' ? '#30362f' : '#ede5d7'} roughness={0.38} metalness={f.type === 'window' ? 0.45 : 0} /></mesh>)}
          {[-1, 1].map((i) => <mesh key={i} position={[0, y + i * (openingHeight / 2 - 0.02), 0]} castShadow receiveShadow><boxGeometry args={[f.width, 0.04, 0.145]} /><meshStandardMaterial color={f.type === 'window' ? '#30362f' : '#ede5d7'} roughness={0.38} /></mesh>)}
          {f.type === 'window' && <mesh position={[0, y - openingHeight / 2 - 0.025, 0]} castShadow receiveShadow><boxGeometry args={[f.width + 0.08, 0.045, 0.23]} /><meshStandardMaterial color="#d8cfbb" roughness={0.35} /></mesh>}
          {f.type === 'door' && [-1, 1].map((side) => <mesh key={side} position={[f.width * 0.34, Math.min(1, f.height * 0.55), side * 0.045]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.012, 0.012, 0.13, 16]} /><meshStandardMaterial color="#bca171" roughness={0.25} metalness={0.85} /></mesh>)}
        </>}
        {f.type === 'door' && low && <Line points={Array.from({ length: 25 }, (_, i) => [-f.width / 2 + Math.cos(i / 24 * Math.PI / 2) * f.width, 0.035, -Math.sin(i / 24 * Math.PI / 2) * f.width] as [number, number, number])} color="#a89679" lineWidth={1} dashed dashSize={0.08} gapSize={0.05} raycast={() => null} />}
      </group>
    })}
    {!low && xs.slice(0, -1).map((left, i) => {
      const right = xs[i + 1], x = (left + right) / 2
      if (openings.some((f) => (f.sillHeight || 0) < 0.1 && Math.abs(x - (f.wallOffset || 0)) < f.width / 2)) return null
      return [-1, 1].map((side) => <mesh key={`${i}-${side}`} position={[x, 0.055, side * 0.073]} castShadow receiveShadow><boxGeometry args={[right - left, 0.11, 0.026]} /><meshStandardMaterial color="#e6dfd2" roughness={0.5} /></mesh>)
    })}
    {selected && <Html center position={[0, height + 0.15, 0]} style={{ pointerEvents: 'none' }}><span className="dimension-tag">{wall.width.toFixed(2)} m</span></Html>}
    {selected && tool === 'select' && [-1, 1].map((side, index) => <mesh key={side} position={[side * wall.width / 2, plan ? 0.16 : height + 0.08, 0]}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation(); drag.current = wallEndpoints(wall)[index]
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        if (controls) (controls as unknown as { enabled: boolean }).enabled = false
        onDragStart(wall.id)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        event.stopPropagation()
        const p = event.ray.intersectPlane(floor, new Vector3())
        if (!p) return
        const next = { x: Math.max(-project.width / 2, Math.min(project.width / 2, Math.round(p.x * 4) / 4)), z: Math.max(-project.length / 2, Math.min(project.length / 2, Math.round(p.z * 4) / 4)) }
        if (project.features.filter((f) => f.type === 'wall').some((f) => { const ends = wallEndpoints(f); return ends.some((end, i) => Math.hypot(end.x - drag.current!.x, end.z - drag.current!.z) < 0.0001 && Math.hypot(ends[1 - i].x - next.x, ends[1 - i].z - next.z) < 0.25) })) return
        onMoveEndpoint(wall.id, drag.current, next)
        drag.current = next
      }} onPointerUp={finish} onPointerCancel={finish}>
      <sphereGeometry args={[0.11, 12, 8]} /><meshBasicMaterial color="#5a8161" />
    </mesh>)}
  </group>
}

export default function SceneEnvironment({ project, viewMode, gridVisible, tool, snap, wallSnap, onClear, onPlace, onDrop, onDrawWall }: {
  project: ProjectState; viewMode: '2d' | '3d'; gridVisible: boolean; tool: string; snap: boolean; wallSnap: boolean
  onClear: () => void; onPlace: (type: 'wall' | 'door' | 'window', x: number, z: number) => void
  onDrop: (id: string, x: number, z: number) => void
  onDrawWall: (x: number, z: number, endX: number, endZ: number) => void
}) {
  const { camera, gl, invalidate } = useThree()
  const readyFrames = useRef(0)
  useFrame(() => {
    if (readyFrames.current >= 2) return
    readyFrames.current += 1
    if (readyFrames.current === 2) gl.domElement.dataset.sceneReady = 'true'
    else invalidate()
  })
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  const [ghost, setGhost] = useState<{ id: string; x: number; z: number; valid: boolean } | null>(null)
  const wallStart = useRef<Point | null>(null)
  const [wallEnd, setWallEnd] = useState<Point | null>(null)
  const capture = useRef<{ element: Element; id: number } | null>(null)
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
  const cancelWall = () => {
    wallStart.current = null; setWallEnd(null)
    if (capture.current) { capture.current.element.releasePointerCapture?.(capture.current.id); capture.current = null }
  }
  useEffect(() => {
    if (tool !== 'wall') cancelWall()
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelWall() }
    window.addEventListener('keydown', cancel); window.addEventListener('blur', cancelWall)
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', cancelWall) }
  }, [tool])
  const wallPoint = (event: ThreeEvent<PointerEvent>) => {
    const p = event.ray.intersectPlane(floor, new Vector3())
    if (!p) return null
    if (event.shiftKey && wallStart.current) {
      if (Math.abs(p.x - wallStart.current.x) > Math.abs(p.z - wallStart.current.z)) p.z = wallStart.current.z
      else p.x = wallStart.current.x
    }
    return snapBuildPoint(p, project)
  }
  const finishWall = (event: ThreeEvent<PointerEvent>) => {
    if (!wallStart.current) return
    event.stopPropagation()
    const start = wallStart.current, end = wallPoint(event)
    if (end && Math.hypot(end.x - start.x, end.z - start.z) >= 0.25) onDrawWall(start.x, start.z, end.x, end.z)
    cancelWall()
  }
  return <>
    <color attach="background" args={['#f4f3ef']} /><ambientLight intensity={1.4} /><hemisphereLight args={['#fff8ed', '#c5c9c3', 1]} />
    <directionalLight castShadow={viewMode === '3d'} position={[3, 9, 5]} intensity={2.3} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.025} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
    <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow
      onClick={(event) => { if (tool === 'select') { event.stopPropagation(); onClear() } else if (tool === 'door' || tool === 'window') { event.stopPropagation(); onPlace(tool, event.point.x, event.point.z) } }}
      onPointerDown={(event) => { if (tool !== 'wall' || event.button !== 0) return; event.stopPropagation(); wallStart.current = wallPoint(event); setWallEnd(wallStart.current); capture.current = { element: event.target as Element, id: event.pointerId }; capture.current.element.setPointerCapture?.(event.pointerId) }}
      onPointerMove={(event) => { if (wallStart.current) { event.stopPropagation(); setWallEnd(wallPoint(event)) } }} onPointerUp={finishWall} onPointerCancel={cancelWall}>
      <planeGeometry args={[project.width, project.length]} /><meshStandardMaterial color="#eeeee7" roughness={1} />
    </mesh>
    {regions.map((region) => <FloorSurface key={region.id} region={region} color={floorColors[project.floorMaterial]} finish={viewMode === '3d' ? project.floorMaterial : undefined} />)}
    {(gridVisible || tool === 'wall' || !regions.length) && <Grid position={[0, 0.005, 0]} args={[project.width, project.length]} cellSize={0.25} sectionSize={1} cellThickness={0.5} sectionThickness={0.9} cellColor="#d0d4c8" sectionColor="#adb8a5" fadeDistance={70} fadeStrength={1} raycast={() => null} />}
    {wallStart.current && wallEnd && <>
      <Line points={[[wallStart.current.x, 0.14, wallStart.current.z], [wallEnd.x, 0.14, wallEnd.z]]} color="#557e61" lineWidth={6} raycast={() => null} />
      <mesh position={[wallEnd.x, 0.16, wallEnd.z]} raycast={() => null}><sphereGeometry args={[0.1, 12, 8]} /><meshBasicMaterial color="#557e61" /></mesh>
      <Html center position={[(wallStart.current.x + wallEnd.x) / 2, 0.3, (wallStart.current.z + wallEnd.z) / 2]} style={{ pointerEvents: 'none' }}><span className="dimension-tag">{Math.hypot(wallEnd.x - wallStart.current.x, wallEnd.z - wallStart.current.z).toFixed(2)} m</span></Html>
    </>}
    {ghost && (() => { const p = productById.get(ghost.id)!; return <group position={[ghost.x, 0.035, ghost.z]}><mesh raycast={() => null}><boxGeometry args={[p.width / 100, 0.025, p.depth / 100]} /><meshBasicMaterial color={ghost.valid ? '#729982' : '#bd7868'} transparent opacity={0.5} /></mesh><Html center position={[0, 0.4, 0]} style={{ pointerEvents: 'none' }}><span className="dimension-tag">{ghost.valid ? `Release to place · ${p.width} × ${p.depth} cm` : 'Place inside a closed room'}</span></Html></group> })()}
  </>
}
