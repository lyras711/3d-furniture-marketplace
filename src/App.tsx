import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SurfaceMaterial from './SurfaceMaterial'

const RenderStudio = lazy(() => import('./RenderStudio'))
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, Html, Line, OrbitControls, RoundedBox, useGLTF } from '@react-three/drei'
import SceneEnvironment, { Architecture } from './SceneEnvironment'
import { CatmullRomCurve3, DoubleSide, MOUSE, Plane, Vector3, OrthographicCamera } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { FormEvent, InputHTMLAttributes } from 'react'
import { products, type CategoryFilter, type Product } from './catalog'
import { attachOpening, clamp, emptyProject, fitsFloor, floorColors, getFloorRegions, isProject, migrateProject, moveWallEndpoint, overlaps, placeObject, placementWarnings, productById, refreshOpenings, snapBuildPoint, wallColors, wallEndpoints, wallFromPoints, type Point, type ProjectState, type RoomFeature, type RoomObject } from './editor'

type ViewMode = '3d' | '2d'
type Tool = 'select' | 'wall' | 'door' | 'window'
type FeatureType = Exclude<Tool, 'select'>

type IconName =
  | 'arrow'
  | 'box'
  | 'chevron'
  | 'close'
  | 'copy'
  | 'cube'
  | 'download'
  | 'grid'
  | 'layers'
  | 'panel'
  | 'plus'
  | 'redo'
  | 'rotate'
  | 'save'
  | 'search'
  | 'share'
  | 'shopping'
  | 'trash'
  | 'undo'
  | 'wall'
  | 'window'

const FLOOR = new Plane(new Vector3(0, 1, 0), 0)
const PRODUCT_DRAG_TYPE = 'application/x-forma-product'

const STORAGE_KEY = 'forma-room-planner-project'
let needsRecovery = false
const EURO = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const categories: CategoryFilter[] = ['All', 'Seating', 'Tables', 'Lighting', 'Decor', 'Storage']

function loadProject(): ProjectState {
  if (typeof window === 'undefined') return emptyProject()
  try {
    const shared = window.location.hash.startsWith('#project=') ? decodeURIComponent(window.location.hash.slice(9)) : null
    const saved = shared || window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = saved ? JSON.parse(saved) : null
    if (!isProject(parsed)) {
      needsRecovery = Boolean(saved)
      return emptyProject()
    }
    if (parsed.schemaVersion !== 2 && !shared && saved) localStorage.setItem(`${STORAGE_KEY}-before-custom-spaces`, saved)
    return migrateProject(parsed)
  } catch {
    needsRecovery = true
    return emptyProject()
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

function formatPrice(value: number | null) {
  return value === null ? 'Price unavailable' : EURO.format(value)
}

function downloadFile(name: string, content: string, type: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    box: 'm4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10',
    chevron: 'm7 10 5 5 5-5',
    close: 'M6 6l12 12M18 6 6 18',
    copy: 'M8 8h11v11H8zM5 16H4V4h12v1',
    cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5m0 0L4 7.5',
    download: 'M12 3v12m-5-5 5 5 5-5M5 20h14',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    layers: 'm4 8 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4',
    panel: 'M4 5h16v14H4zM15 5v14',
    plus: 'M12 5v14M5 12h14',
    redo: 'M19 12a7 7 0 0 0-12-5l-2 2m0 0h5m-5 0V4',
    rotate: 'M5 8a7 7 0 1 1 1 8M5 8V4m0 4h4',
    save: 'M5 4h12l2 2v14H5zM8 4v5h7V4M8 15h8v5H8z',
    search: 'm20 20-4.5-4.5M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z',
    share: 'M15 8l-6 4 6 4M15 8V5l5 3-5 3M9 12H4m5 0v7l-5-3 5-3',
    shopping: 'M5 7h14l-1 13H6L5 7Zm3 0a4 4 0 0 1 8 0M9 11v2m6-2v2',
    trash: 'M5 7h14m-9 4v5m4-5v5M9 7V4h6v3m-9 0 1 13h10l1-13',
    undo: 'M5 12a7 7 0 0 1 12-5l2 2m0 0h-5m5 0V4',
    wall: 'M4 5h16v14H4zM9 5v14m6-14v14M4 10h5m6 0h5M4 15h5m6 0h5',
    window: 'M4 4h16v16H4zM4 12h16M12 4v16',
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

function ProductThumb({ product, compact = false }: { product: Product; compact?: boolean }) {
  const seating = product.group === 'Seating', table = product.group === 'Tables'
  const className = `product-thumb ${compact ? 'product-thumb-compact' : ''}`
  if (product.thumbnailPath) return <div className={className}><img className="product-thumb-image" src={product.thumbnailPath} alt={`${product.name} generated thumbnail`} /></div>
  return <div className={className}>
    <svg viewBox="0 0 180 130" role="img" aria-label={`${product.name} — illustrative preview`}>
      <ellipse cx="92" cy="108" rx="65" ry="10" fill="#ddd7cb" opacity="0.45" />
      <g stroke={product.accent} strokeWidth="1.3" strokeLinejoin="round">
        {seating ? <g>
          <path d="M38 91v17m92-18v18m-75-5v9m87-22v12" strokeWidth="4" />
          <path d={(product.category === 'Sofa' || product.category === 'Corner sofa') ? 'M28 55 Q28 43 40 45 L135 35 Q145 35 145 48 L145 84 L30 94Z' : 'M64 30 L116 25 L119 76 L67 84Z'} fill={product.tone} />
          <path d={(product.category === 'Sofa' || product.category === 'Corner sofa') ? 'M31 78 L125 65 L150 80 L56 99 L31 91Z' : 'M64 77 L113 68 L133 82 L84 95 L64 85Z'} fill={product.tone} />
          {(product.category === 'Sofa' || product.category === 'Corner sofa') && <><path d="M29 68 Q21 64 22 74 L23 92 L40 99 L40 77Z M132 55 L147 53 L156 61 L155 83 L139 88 L138 65Z" fill={product.accent} /><path d="M61 53v23m35-26v22M42 80l94-14" fill="none" opacity="0.5" /></>}
        </g> : table ? <g><path d="M44 64v39m89-50v37M63 80v31m85-45v39" strokeWidth="6" /><path d="M27 59 L115 36 L159 62 L69 91 L27 68Z" fill={product.accent} /><path d="M27 59 L115 36 L159 62 L69 84Z" fill={product.tone} /><path d="M42 60l72-18M54 67l71-19" opacity="0.35" /></g> : product.category === 'Rug' ? <g><path d="M23 79 L116 43 L163 78 L65 113Z" fill={product.tone} /><path d="M33 80l83-31 36 28-85 29Z" fill="none" /><path d="M43 81l70-26m-60 34 72-27m-60 34 71-28" opacity="0.3" /></g> : product.category === 'Floor lamp' ? <g><ellipse cx="91" cy="107" rx="24" ry="5" fill={product.accent} /><path d="M91 104V38" strokeWidth="3" /><path d="M75 23h31l19 34Q92 68 57 57Z" fill={product.tone} /><ellipse cx="91" cy="23" rx="16" ry="4" fill="#eee5d2" /></g> : product.category === 'Plant' ? <g><path d="M71 86h41l-7 26H78Z" fill="#b3a28c" stroke="#8b7964" /><path d="M92 90V30m0 34L68 47m24 32 22-23" fill="none" strokeWidth="3" /><ellipse cx="69" cy="41" rx="14" ry="23" transform="rotate(-35 69 41)" fill={product.tone} /><ellipse cx="112" cy="48" rx="15" ry="24" transform="rotate(25 112 48)" fill={product.accent} /><ellipse cx="91" cy="28" rx="13" ry="23" fill={product.tone} /></g> : <g><path d="M36 49 L123 31 L148 46 L61 66Z" fill={product.tone} /><path d="M36 49v44l25 16V66Z" fill={product.accent} /><path d="M61 66l87-20v44l-87 19Z" fill={product.tone} /><path d="M89 60v42m31-49v42M38 96v10m105-13v10" fill="none" strokeWidth="2" />{product.category === 'Shelving' && <path d="M64 80l82-19M64 95l82-19" strokeWidth="5" />}</g>}
      </g>
    </svg>
  </div>
}

function CameraRig({ viewMode, cameraVersion, project }: { viewMode: ViewMode; cameraVersion: number; project: ProjectState }) {
  const { camera, size, controls, invalidate } = useThree()
  const latest = useRef(project)
  latest.current = project
  useEffect(() => {
    const orbit = controls as unknown as { target: Vector3; update: () => void } | null
    const points = latest.current.features.filter((f) => f.type === 'wall').flatMap(wallEndpoints)
    const fitted = viewMode === '3d' && points.length > 0
    const minX = fitted ? Math.min(...points.map((p) => p.x)) : -project.width / 2, maxX = fitted ? Math.max(...points.map((p) => p.x)) : project.width / 2
    const minZ = fitted ? Math.min(...points.map((p) => p.z)) : -project.length / 2, maxZ = fitted ? Math.max(...points.map((p) => p.z)) : project.length / 2
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, w = Math.max(3, maxX - minX), l = Math.max(3, maxZ - minZ)
    const targetY = viewMode === '2d' ? 0 : project.ceilingHeight * 0.24
    orbit?.target.set(cx, targetY, cz)
    camera.position.set(...(viewMode === '2d' ? [cx, 12, cz + 0.001] : [cx + 8, 7.5 + targetY, cz + 10]) as [number, number, number])
    camera.lookAt(cx, targetY, cz)
    const cam = camera as OrthographicCamera
    const spanX = viewMode === '2d' ? project.width + 1.2 : (w + l) * 0.8 + 1
    const spanY = viewMode === '2d' ? project.length + 1.8 : (w + l) * 0.46 + project.ceilingHeight * 0.85 + 0.8
    cam.zoom = Math.min(size.width / spanX, size.height / spanY)
    cam.updateProjectionMatrix()
    orbit?.update()
    invalidate()
  }, [camera, controls, size.width, size.height, cameraVersion, viewMode, project.width, project.length, project.ceilingHeight, invalidate])
  return null
}

function Cushion({ width, height, depth, color }: { width: number; height: number; depth: number; color: string }) {
  const seam = useMemo(() => {
    const r = Math.min(0.045, height / 3), w = width / 2 - r, d = depth / 2 - r
    return new CatmullRomCurve3(Array.from({ length: 48 }, (_, i) => {
      const corner = Math.floor(i / 12), angle = corner * Math.PI / 2 + i % 12 / 12 * Math.PI / 2
      return new Vector3((corner === 0 || corner === 3 ? w : -w) + Math.cos(angle) * r, height * 0.22, (corner < 2 ? d : -d) + Math.sin(angle) * r)
    }), true)
  }, [width, height, depth])
  return <group><RoundedBox args={[width, height, depth]} radius={Math.min(0.065, height / 2 - 0.001)} smoothness={4} castShadow receiveShadow><SurfaceMaterial kind="linen" color={color} /></RoundedBox><mesh castShadow><tubeGeometry args={[seam, 96, 0.0018, 5, true]} /><meshStandardMaterial color={color} roughness={0.95} /></mesh></group>
}

function ImportedProductModel({ path, product, variantId }: { path: string; product: Product; variantId?: string }) {
  const { scene } = useGLTF(path)
  const variant = product.variants?.find((candidate) => candidate.id === variantId)
  const tone = variant?.tone || product.tone
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((object) => {
      object.castShadow = true
      object.receiveShadow = true
      const mesh = object as unknown as { isMesh?: boolean; material?: unknown }
      if (!mesh.isMesh || !mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const cloned = materials.map((material) => {
        const next = (material as { clone: () => { name?: string; color?: { set: (value: string) => void } } }).clone()
        if (next.color && /upholstery|cushion|fabric/i.test(next.name || '')) next.color.set(tone)
        return next
      })
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]
    })
    return clone
  }, [scene, path, tone])
  return <primitive object={model} />
}

export function ProductModel({ product, variantId }: { product: Product; variantId?: string }) {
  const modelPath = product.variants?.find((variant) => variant.id === variantId)?.modelPath || product.modelPath
  if (modelPath) return <ImportedProductModel path={modelPath} product={product} variantId={variantId} />
  const width = product.width / 100
  const depth = product.depth / 100
  const height = product.height / 100
  const fabric = product.group === 'Seating' || product.category === 'Rug'
  const material = <SurfaceMaterial kind={fabric ? 'linen' : 'oak'} color={product.tone} />
  const darkMaterial = <SurfaceMaterial kind="oak" color={product.accent} />

  if ((product.category === 'Sofa' || product.category === 'Corner sofa')) {
    return (
      <group>
        <RoundedBox args={[width, height * 0.27, depth]} radius={0.045} smoothness={3} position={[0, height * 0.26, 0]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.95, height * 0.53, depth * 0.16]} radius={0.035} smoothness={4} position={[0, height * 0.7, -depth * 0.41]} castShadow receiveShadow>{material}</RoundedBox>
        {[-1, 0, 1].map((i) => <group key={i}>
          <group position={[i * width * 0.27, height * 0.48, depth * 0.08]}><Cushion width={width * 0.265} height={height * 0.18} depth={depth * 0.68} color={product.tone} /></group>
          <group position={[i * width * 0.27, height * 0.76, -depth * 0.28]} rotation={[Math.PI / 2 - 0.1, 0, 0]}><Cushion width={width * 0.265} height={depth * 0.19} depth={height * 0.45} color={product.tone} /></group>
        </group>)}
        {[-1, 1].map((i) => <RoundedBox key={i} args={[width * 0.09, height * 0.56, depth]} radius={0.04} smoothness={3} position={[i * width * 0.455, height * 0.46, 0]} castShadow>{material}</RoundedBox>)}
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * width * 0.4, 0.06, z * depth * 0.36]} castShadow><cylinderGeometry args={[0.025, 0.02, 0.12, 8]} />{darkMaterial}</mesh>))}
      </group>
    )
  }

  if (product.category === 'Coffee table' || product.category === 'Dining table') {
    const legHeight = Math.max(0.32, height * 0.86)
    return (
      <group>
        <RoundedBox args={[width, 0.055, depth]} radius={0.018} smoothness={4} position={[0, height - 0.0275, 0]} castShadow receiveShadow>{material}</RoundedBox>
        {[-1, 1].map((side) => <RoundedBox key={side} args={[width * 0.79, 0.08, 0.035]} radius={0.007} position={[0, height - 0.095, side * depth * 0.36]} castShadow>{darkMaterial}</RoundedBox>)}
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
          <mesh key={`${x}-${z}`} position={[x * width * 0.39, legHeight / 2, z * depth * 0.38]} castShadow>{<cylinderGeometry args={[0.035, 0.035, legHeight, 12]} />}{darkMaterial}</mesh>
        )))}
      </group>
    )
  }

  if (product.category === 'Dining chair') {
    return (
      <group>
        <group position={[0, height * 0.5, 0]}><Cushion width={width} height={0.09} depth={depth} color={product.tone} /></group>
        <RoundedBox args={[width * 0.92, height * 0.38, 0.085]} radius={0.035} smoothness={4} position={[0, height * 0.8, -depth * 0.39]} rotation={[-0.08, 0, 0]} castShadow receiveShadow>{material}</RoundedBox>
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
          <mesh key={`${x}-${z}`} position={[x * width * 0.34, height * 0.22, z * depth * 0.34]} castShadow>{<cylinderGeometry args={[0.018, 0.018, height * 0.44, 8]} />}{darkMaterial}</mesh>
        )))}
      </group>
    )
  }

  if (product.category === 'Rug') {
    return <RoundedBox args={[width, height, depth]} radius={0.003} smoothness={2} position={[0, height / 2, 0]} receiveShadow>{material}</RoundedBox>
  }

  if (product.category === 'TV unit') {
    return (
      <group>
        <RoundedBox args={[width, height * 0.8, depth * 0.95]} radius={0.008} position={[0, height * 0.6, -depth * 0.025]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
        {[-1, 0, 1].map((i) => <RoundedBox key={i} args={[width / 3 - 0.006, height * 0.76, 0.025]} radius={0.004} position={[i * width / 3, height * 0.59, depth / 2 - 0.0125]} castShadow receiveShadow>{material}</RoundedBox>)}
        {[-1, 1].map((side) => <mesh key={side} position={[side * width * 0.37, height * 0.1, 0]} castShadow><boxGeometry args={[0.055, height * 0.2, depth * 0.75]} /><meshStandardMaterial color="#37372f" roughness={0.4} metalness={0.5} /></mesh>)}
      </group>
    )
  }

  if (product.category === 'Floor lamp') {
    return (
      <group>
        <mesh position={[0, 0.025, 0]} castShadow receiveShadow><cylinderGeometry args={[width * 0.38, width * 0.44, 0.05, 48]} /><meshStandardMaterial color="#44413a" roughness={0.3} metalness={0.75} /></mesh>
        <mesh position={[0, height * 0.47, 0]} castShadow><cylinderGeometry args={[0.009, 0.012, height * 0.92, 24]} /><meshStandardMaterial color="#b7a077" roughness={0.28} metalness={0.85} /></mesh>
        <mesh position={[0, height * 0.86, 0]} castShadow receiveShadow><cylinderGeometry args={[width * 0.3, width * 0.5, height * 0.28, 64, 1, true]} /><meshPhysicalMaterial color="#e7dbbf" roughness={0.9} side={DoubleSide} sheen={0.3} emissive="#ffe1a3" emissiveIntensity={0.12} /></mesh>
        <mesh position={[0, height * 0.82, 0]}><sphereGeometry args={[0.035, 16, 12]} /><meshStandardMaterial color="#fff1d5" emissive="#ffd397" emissiveIntensity={8} /></mesh>
        <pointLight position={[0, height * 0.79, 0]} color="#ffdeaa" intensity={3} distance={4} decay={2} />
      </group>
    )
  }

  if (product.category === 'Plant') {
    return (
      <group>
        <mesh position={[0, height * 0.11, 0]} castShadow receiveShadow><cylinderGeometry args={[width * 0.36, width * 0.29, height * 0.22, 48, 1, true]} /><meshStandardMaterial color="#baad96" roughness={0.85} side={DoubleSide} /></mesh>
        <mesh position={[0, height * 0.205, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[width * 0.345, 48]} /><meshStandardMaterial color="#393327" roughness={1} /></mesh>
        <mesh position={[0, height * 0.56, 0]} castShadow><cylinderGeometry args={[0.005, 0.014, height * 0.86, 12]} /><meshStandardMaterial color="#6c6044" roughness={0.95} /></mesh>
        {Array.from({ length: 18 }, (_, i) => <group key={i} position={[0, height * (0.36 + i * 0.031), 0]} rotation={[0.55, i * 2.4, 0.65]}>
          <mesh position={[0, 0.09, 0]} castShadow><cylinderGeometry args={[0.0015, 0.003, 0.18, 6]} /><meshStandardMaterial color="#73684b" roughness={1} /></mesh>
          {Array.from({ length: 10 }, (_, j) => <mesh key={j} position={[(j % 2 ? 1 : -1) * 0.024, 0.045 + j * 0.014, 0]} rotation={[j * 0.7, j * 1.1, j % 2 ? -0.7 : 0.7]} scale={[0.012, 0.036, 0.002]} castShadow receiveShadow><sphereGeometry args={[1, 8, 6]} /><meshPhysicalMaterial color={j % 3 ? product.tone : '#a1a78a'} roughness={0.58} sheen={0.2} /></mesh>)}
        </group>)}
      </group>
    )
  }

  return <group>
    {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * (width / 2 - 0.02), height / 2, z * (depth / 2 - 0.02)]} castShadow><boxGeometry args={[0.04, height, 0.04]} />{darkMaterial}</mesh>))}
    {[0, 1, 2, 3, 4].map((i) => <mesh key={i} position={[0, 0.06 + i * (height - 0.08) / 4, 0]} castShadow receiveShadow><boxGeometry args={[width, 0.04, depth]} />{material}</mesh>)}
  </group>
}

function FurnitureObject({
  object,
  product,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  viewMode,
  selectable,
}: {
  selectable: boolean
  viewMode: ViewMode
  object: RoomObject
  product: Product
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragMove: (x: number, z: number) => void
  onDragEnd: () => void
}) {
  const width = product.width / 100
  const depth = product.depth / 100
  const drag = useRef<{ x: number; z: number } | null>(null)
  const { controls, gl } = useThree()
  const finish = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    event.stopPropagation()
    drag.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    gl.domElement.style.cursor = 'grab'
    onDragEnd()
  }
  return (
    <group position={[object.x, 0, object.z]} rotation={[0, object.rotation, 0]}
      onClick={(event) => { if (selectable) event.stopPropagation() }}
      onPointerOver={(event) => { if (selectable) { event.stopPropagation(); gl.domElement.style.cursor = 'grab' } }}
      onPointerOut={() => { if (!drag.current) gl.domElement.style.cursor = 'auto' }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !selectable) return
        const point = event.ray.intersectPlane(FLOOR, new Vector3())
        if (!point) return
        event.stopPropagation()
        drag.current = { x: point.x - object.x, z: point.z - object.z }
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        if (controls) (controls as unknown as { enabled: boolean }).enabled = false
        gl.domElement.style.cursor = 'grabbing'
        onSelect()
        onDragStart()
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        event.stopPropagation()
        const point = event.ray.intersectPlane(FLOOR, new Vector3())
        if (point) onDragMove(point.x - drag.current.x, point.z - drag.current.z)
      }}
      onPointerUp={finish} onPointerCancel={finish}
    >
      {viewMode === '2d' ? <mesh position={[0, product.category === 'Rug' ? 0.015 : 0.06, 0]}><boxGeometry args={[width, 0.02, depth]} /><meshBasicMaterial color={product.tone} transparent opacity={product.category === 'Rug' ? 0.4 : 0.9} /><Edges color={selected ? '#507759' : '#8f9788'} lineWidth={1} /></mesh> : <ProductModel product={product} variantId={object.variantId} />}
      {selected && <>
        <Line points={[[-width / 2 - 0.04, 0.045, -depth / 2 - 0.04], [width / 2 + 0.04, 0.045, -depth / 2 - 0.04], [width / 2 + 0.04, 0.045, depth / 2 + 0.04], [-width / 2 - 0.04, 0.045, depth / 2 + 0.04], [-width / 2 - 0.04, 0.045, -depth / 2 - 0.04]]} color="#517e68" lineWidth={2} raycast={() => null} />
        <Html position={[0, 0.05, depth / 2 + 0.18]} center style={{ pointerEvents: 'none' }}><span className="dimension-tag">{product.width} × {product.depth} cm</span></Html>
      </>}
    </group>
  )
}

function RoomScene({
  project,
  viewMode,
  gridVisible,
  wallsTransparent,
  selectedId,
  selectedFeatureId,
  activeTool,
  draggingId,
  cameraVersion,
  onClearSelection,
  onSelectObject,
  onSelectFeature,
  onPlaceFeature,
  onMoveObject,
  onDragStart,
  onDragEnd,
  snap, wallSnap, onDropProduct, onDrawWall, onMoveEndpoint,
}: {
  onMoveEndpoint: (id: string, previous: Point, next: Point) => void
  snap: boolean
  wallSnap: boolean
  onDropProduct: (id: string, x: number, z: number) => void
  onDrawWall: (x: number, z: number, endX: number, endZ: number) => void
  project: ProjectState
  viewMode: ViewMode
  gridVisible: boolean
  wallsTransparent: boolean
  selectedId: string | null
  selectedFeatureId: string | null
  activeTool: Tool
  draggingId: string | null
  cameraVersion: number
  onClearSelection: () => void
  onSelectObject: (id: string) => void
  onSelectFeature: (id: string) => void
  onPlaceFeature: (type: FeatureType, x: number, z: number) => void
  onMoveObject: (id: string, x: number, z: number) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  return (
    <Canvas shadows orthographic frameloop="demand" dpr={[1, 1.75]}
      camera={{ position: [8, 8, 10], zoom: 65, near: 0.1, far: 150 }}
      gl={{ antialias: true }} onPointerMissed={() => { if (!draggingId && activeTool === 'select') onClearSelection() }}>
      <OrbitControls makeDefault enabled={!draggingId} enableRotate={viewMode === '3d' && activeTool === 'select'} enableDamping dampingFactor={0.12} minZoom={1} maxZoom={250} minPolarAngle={viewMode === '2d' ? 0 : 0.1} maxPolarAngle={Math.PI / 2.1} mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} />
      <CameraRig project={project} viewMode={viewMode} cameraVersion={cameraVersion} />
      <Suspense fallback={null}>
      <SceneEnvironment project={project} viewMode={viewMode} gridVisible={gridVisible} tool={activeTool} snap={snap} wallSnap={wallSnap} onClear={onClearSelection} onPlace={onPlaceFeature} onDrop={onDropProduct} onDrawWall={onDrawWall} />

      <Architecture project={project} viewMode={viewMode} cutaway={wallsTransparent} selectedId={selectedFeatureId} tool={activeTool} onSelect={onSelectFeature} onPlace={onPlaceFeature} onMoveEndpoint={onMoveEndpoint} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      {project.objects.map((object) => {
        const product = productById.get(object.productId)
        if (!product) return null
        return (
          <FurnitureObject
            key={object.id}
            object={object}
            viewMode={viewMode}
            selectable={activeTool === 'select'}
            product={product}
            selected={object.id === selectedId}
            onSelect={() => onSelectObject(object.id)}
            onDragStart={() => onDragStart(object.id)}
            onDragMove={(x, z) => onMoveObject(object.id, x, z)}
            onDragEnd={onDragEnd}
          />
        )
      })}
      </Suspense>
    </Canvas>
  )
}

function FloorPlanPreview({ project }: { project: ProjectState }) {
  const regions = getFloorRegions(project.features)
  return <div className="floor-plan-preview"><svg viewBox={`${-project.width / 2 - 0.2} ${-project.length / 2 - 0.2} ${project.width + 0.4} ${project.length + 0.4}`} width="100%" height="100%" aria-label="Live drawn floor plan">
    {regions.map((r) => <path key={r.id} d={[r.points, ...r.holes].map((ring) => `M${ring.map((p) => `${p.x},${p.z}`).join('L')}Z`).join(' ')} fill="#e0e6d7" fillRule="evenodd" />)}
    {project.objects.map((o) => { const p = productById.get(o.productId)!; return <rect key={o.id} x={-p.width / 200} y={-p.depth / 200} width={p.width / 100} height={p.depth / 100} transform={`translate(${o.x} ${o.z}) rotate(${-o.rotation * 180 / Math.PI})`} fill={p.tone} stroke="#8e9d82" strokeWidth="0.04" /> })}
    {project.features.map((f) => { const [a, b] = wallEndpoints(f); return <line key={f.id} x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke={f.type === 'wall' ? '#8f9d82' : f.type === 'door' ? '#ba976e' : '#84b0b5'} strokeWidth={f.type === 'wall' ? 0.12 : 0.16} /> })}
  </svg></div>
}

function NumberInput({ value, onCommit, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return <input {...props} type="number" value={text} onChange={(event) => setText(event.target.value)} onBlur={(event) => {
    const raw = event.currentTarget.value
    if (!raw.trim() || !Number.isFinite(Number(raw))) { setText(String(value)); return }
    const next = clamp(Number(raw), props.min === undefined ? -Infinity : Number(props.min), props.max === undefined ? Infinity : Number(props.max))
    setText(String(value))
    onCommit(next)
  }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(value); setText(String(value)); event.currentTarget.blur() } }} />
}

function RoomProperties({ project, onPatch }: { project: ProjectState; onPatch: (patch: Partial<ProjectState>) => void }) {
  const warnings = placementWarnings(project), regions = getFloorRegions(project.features)
  return (
    <>
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">Your own layout</span>
          <h2>Space overview</h2>
        </div>
        <span className="status-pill">Metric</span>
      </div>
      <section className="inspector-section">
        <div className="section-label-row"><span>Built by you</span><span className="muted">Live geometry</span></div>
        <div className="spec-grid"><div><strong>{project.features.filter((f) => f.type === 'wall').length}</strong><span>Walls</span></div><div><strong>{regions.length}</strong><span>Closed rooms</span></div><div><strong>{regions.reduce((sum, r) => sum + r.area, 0).toFixed(1)}</strong><span>Floor m²</span></div></div>
        <p className="muted">{regions.length ? 'Floors follow your walls. Move a corner to reshape connected walls, or delete a wall to open the room.' : 'Draw connected walls on the grid. The floor appears when the outline closes.'}</p>
        <label className="field-label">New wall height (m)<NumberInput min="2" max="6" step="0.1" value={project.ceilingHeight} onCommit={(ceilingHeight) => onPatch({ ceilingHeight })} /></label>
        <details className="build-grid-settings"><summary>Build grid settings</summary><p className="muted">Expand the canvas without resizing your rooms.</p><div className="dimension-grid"><label><span>Grid width</span><NumberInput min={project.width} max="40" step="1" value={project.width} onCommit={(width) => onPatch({ width })} /></label><label><span>Grid length</span><NumberInput min={project.length} max="40" step="1" value={project.length} onCommit={(length) => onPatch({ length })} /></label></div></details>
      </section>
      <section className="inspector-section">
        <div className="section-label-row"><span>Materials</span><span className="muted">Room finishes</span></div>
        <label className="material-row"><span className="material-swatch" style={{ background: floorColors[project.floorMaterial] }} /><span className="field-label">Floor finish<select value={project.floorMaterial} onChange={(event) => onPatch({ floorMaterial: event.target.value })}>{Object.keys(floorColors).map((name) => <option key={name}>{name}</option>)}</select></span></label>
        <label className="material-row"><span className="material-swatch" style={{ background: wallColors[project.wallMaterial] }} /><span className="field-label">Wall finish<select value={project.wallMaterial} onChange={(event) => onPatch({ wallMaterial: event.target.value })}>{Object.keys(wallColors).map((name) => <option key={name}>{name}</option>)}</select></span></label>
      </section>
      <section className="inspector-section room-health">
        <div className="section-label-row"><span>Space check</span><span className="check-count">{project.objects.length} items</span></div>
        {warnings.length ? warnings.map((warning, i) => <div className="health-row warning" key={i}><span className="health-dot" />{warning.message}</div>) : <div className="health-row"><span className="health-dot good" />No boundary or furniture overlap warnings</div>}
        <p className="muted">Basic footprint checks. Verify circulation and delivery access before purchase.</p>
      </section>
      <div className="inspector-tip"><span className="tip-icon">i</span><span>Click any item in the room to inspect its exact dimensions and move it with drag.</span></div>
    </>
  )
}

function ObjectProperties({
  object,
  product,
  onPatch,
  onRotate,
  onDuplicate,
  onDelete,
  onClose,
}: {
  onClose: () => void
  object: RoomObject
  product: Product
  onPatch: (patch: Partial<RoomObject>) => void
  onRotate: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <>
      <div className="inspector-heading inspector-heading-product">
        <div>
          <span className="eyebrow">Selected product</span>
          <h2>{product.name}</h2>
        </div>
        <button className="icon-button" title="Close selection" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="selected-product-card"><ProductThumb product={{ ...product, thumbnailPath: product.variants?.find((variant) => variant.id === object.variantId)?.thumbnailPath || product.thumbnailPath }} compact /><div><strong>{product.brand}</strong><span>{product.retailer}</span><small>{product.sku}</small></div></div>
      {product.verification && <p className="muted">Photo-based reconstruction · visual review pending. Fabric and fine details are inferred, not manufacturer-verified.</p>}
      <section className="inspector-section">
        <div className="section-label-row"><span>Dimensions</span><span className="verified-label">{product.status.includes('Verified') ? 'Verified' : 'Check status'}</span></div>
        <div className="spec-grid"><div><strong>{product.width}</strong><span>Length cm</span></div><div><strong>{product.depth}</strong><span>{product.cornerDepth ? 'Corner depth cm' : 'Depth cm'}</span></div><div><strong>{product.height}</strong><span>Height cm</span></div></div>
      </section>
      {product.variants?.length ? <section className="inspector-section">
        <div className="section-label-row"><span>Colour variant</span><span className="muted">Generated material</span></div>
        <label className="field-label"><span>Finish</span><select aria-label="Product variant" value={object.variantId || product.variants[0].id} onChange={(event) => onPatch({ variantId: event.target.value })}>{product.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}{variant.sourceVariantName ? ` · ${variant.sourceVariantName}` : ''}</option>)}</select></label>
      </section> : null}
      <section className="inspector-section">
        <div className="section-label-row"><span>Placement</span><span className="muted">metres / degrees</span></div>
        <div className="dimension-grid placement-grid">
          <label><span>X</span><NumberInput step="0.05" value={object.x.toFixed(2)} onCommit={(x) => onPatch({ x })} /></label>
          <label><span>Rotation</span><NumberInput step="15" value={Math.round((object.rotation * 180) / Math.PI)} onCommit={(rotation) => onPatch({ rotation: rotation * Math.PI / 180 })} /></label>
          <label><span>Z</span><NumberInput step="0.05" value={object.z.toFixed(2)} onCommit={(z) => onPatch({ z })} /></label>
        </div>
        <button className="rotate-button" onClick={onRotate}><Icon name="rotate" /> Rotate 15°</button>
      </section>
      <section className="inspector-section product-price-section"><div><span className="muted">Unit price</span><strong className="price-large">{formatPrice(product.price)}</strong></div><span className="price-status">{product.status}</span></section>
      <div className="inspector-actions"><button className="secondary-button" onClick={onDuplicate}><Icon name="copy" /> Duplicate</button><button className="danger-button" onClick={onDelete}><Icon name="trash" /> Delete</button></div>
    </>
  )
}

function FeatureProperties({ project, feature, onPatch, onDelete }: { project: ProjectState; feature: RoomFeature; onPatch: (patch: Partial<RoomFeature>) => void; onDelete: () => void }) {
  const title = feature.type === 'wall' ? 'Wall' : feature.type === 'door' ? 'Door opening' : 'Window opening'
  return (
    <>
      <div className="inspector-heading"><div><span className="eyebrow">Architecture</span><h2>{title}</h2></div><span className="status-pill">Editable</span></div>
      <section className="inspector-section"><div className="section-label-row"><span>{feature.type === 'wall' ? 'Wall size' : 'Opening size'}</span><span className="muted">metres</span></div><div className="dimension-grid"><label><span>Width</span><NumberInput min="0.3" max="20" step="0.05" value={feature.width} onCommit={(width) => onPatch({ width })} /></label><label><span>Height</span><NumberInput min="0.3" max="6" step="0.05" value={feature.height} onCommit={(height) => onPatch({ height })} /></label>{feature.type === 'window' && <label><span>Sill</span><NumberInput min="0" max="6" step="0.05" value={feature.sillHeight || 0} onCommit={(sillHeight) => onPatch({ sillHeight })} /></label>}</div></section>
      <section className="inspector-section"><div className="section-label-row"><span>Position</span><span className="muted">metres / degrees</span></div>{feature.type === 'wall' ? <><div className="dimension-grid placement-grid"><label><span>X</span><NumberInput step="0.05" value={feature.x.toFixed(2)} onCommit={(x) => onPatch({ x })} /></label><label><span>Rotation</span><NumberInput step="15" value={Math.round((feature.rotation * 180) / Math.PI)} onCommit={(rotation) => onPatch({ rotation: rotation * Math.PI / 180 })} /></label><label><span>Z</span><NumberInput step="0.05" value={feature.z.toFixed(2)} onCommit={(z) => onPatch({ z })} /></label></div><p className="muted">Drag a green corner in 2D. Connected walls follow it; floors update automatically. Deleting this wall also removes its doors and windows.</p></> : <><label className="field-label">Attached wall<select value={feature.wallId} onChange={(event) => onPatch({ wallId: event.target.value, wallOffset: 0 })}>{project.features.filter((f) => f.type === 'wall' && f.width >= 0.5).map((wall, i) => <option key={wall.id} value={wall.id}>Wall {i + 1} · {wall.width.toFixed(2)} m</option>)}</select></label><label className="field-label">Position along wall (m)<NumberInput step="0.1" value={feature.wallOffset || 0} onCommit={(wallOffset) => onPatch({ wallOffset })} /></label><p className="muted">Measured from the wall centre. Openings follow their wall when you reshape the space.</p></>}</section>
      <div className="inspector-actions"><button className="danger-button" onClick={onDelete}><Icon name="trash" /> Remove {feature.type}</button></div>
    </>
  )
}

function ShoppingDrawer({
  items,
  total,
  onClose,
  onExport,
  onRequest,
}: {
  items: { product: Product; quantity: number; subtotal: number }[]
  total: number
  onClose: () => void
  onExport: () => void
  onRequest: () => void
}) {
  const retailers = new Set(items.map((item) => item.product.retailer)).size
  return (
    <>
      <button className="drawer-backdrop" aria-label="Close shopping list" onClick={onClose} />
      <aside className="shopping-drawer" role="dialog" aria-modal="true" aria-label="Shopping list">
        <div className="drawer-header"><div><span className="eyebrow">Purchase-ready list</span><h2>Shopping list</h2></div><button className="icon-button" onClick={onClose} title="Close shopping list"><Icon name="close" /></button></div>
        <div className="drawer-intro"><span className="drawer-check">✓</span><p>{items.length} products from {retailers} retailers<br /><small>Grouped by product and SKU</small></p></div>
        <div className="shopping-items">
          {items.map(({ product, quantity, subtotal }) => (
            <div className="shopping-item" key={product.id}><ProductThumb product={product} compact /><div className="shopping-item-info"><strong>{product.name}</strong><span>{product.retailer} · {product.sku}</span><small>{product.width} × {product.depth} × {product.height} cm · {formatPrice(product.price)} each</small><small>{product.status}</small></div><div className="shopping-item-price"><span>×{quantity}</span><strong>{formatPrice(subtotal)}</strong></div></div>
          ))}
          {items.length === 0 ? <div className="empty-search">Your room is empty. Add a piece from the catalogue to start your list.</div> : <section className="retailer-summary"><h3>By retailer</h3>{[...new Set(items.map((item) => item.product.retailer))].map((name) => <div key={name}><span>{name}</span><strong>{formatPrice(items.filter((item) => item.product.retailer === name).reduce((sum, item) => sum + item.subtotal, 0))}</strong></div>)}</section>}
        </div>
        <div className="drawer-total"><div><span>Estimated total</span><small>Prices and availability are subject to retailer confirmation.</small></div><strong>{formatPrice(total)}</strong></div>
        <div className="drawer-actions"><button className="secondary-button" onClick={onExport}><Icon name="download" /> Export CSV</button><button className="primary-button" onClick={onRequest} disabled={!items.length}><Icon name="arrow" /> Request a quote</button></div>
      </aside>
    </>
  )
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (project: ProjectState) => void }) {
  const [name, setName] = useState('My space')
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate(emptyProject(name.trim() || 'My space')) }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close new project dialog" /><form className="modal-card" role="dialog" aria-modal="true" aria-label="Project dialog" onSubmit={submit}>
    <div className="modal-header"><div><span className="eyebrow">No templates. Your layout.</span><h2>Create your space</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    <label className="field-label">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p className="catalog-intro">Start on an empty metric grid. Draw the walls, close the outline, then make it yours with furniture from the catalogue.</p>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Create space <Icon name="arrow" /></button></div>
  </form></div>
}

function PurchaseRequestModal({ project, total, onClose }: { project: ProjectState; total: number; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const customer = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement))
    const items = project.objects.map((object) => ({ objectId: object.id, product: productById.get(object.productId) }))
    downloadFile('forma-quote-request.json', JSON.stringify({ createdAt: new Date().toISOString(), status: 'draft', customer, project, items, estimatedTotal: total, currency: 'EUR' }, null, 2), 'application/json')
    setSubmitted(true)
  }
  return (
    <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close purchase request" />{submitted ? <div className="modal-card success-card" role="dialog" aria-modal="true" aria-label="Quote draft exported"><div className="success-icon">✓</div><span className="eyebrow">Quote draft exported</span><h2>Your request is ready.</h2><p>Your downloaded file contains your contact details, room plan and product snapshots. Nothing has been sent to a retailer. Keep the file private and share it only with your chosen partner.</p><button className="primary-button" autoFocus onClick={onClose}>Back to room</button></div> : <form className="modal-card" role="dialog" aria-modal="true" aria-label="Project dialog" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">Estimated total {formatPrice(total)}</span><h2>Request a quote</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid"><label className="field-label">Full name<input name="name" required placeholder="Your name" /></label><label className="field-label">Email<input name="email" required type="email" placeholder="you@example.com" /></label><label className="field-label">Phone<input name="phone" type="tel" placeholder="+30 69..." /></label><label className="field-label">Delivery city<input name="city" required placeholder="Athens" /></label></div><label className="field-label">Notes<textarea name="notes" rows={3} placeholder="Anything we should know about delivery or installation?" /></label><p className="form-note">Demo: this downloads a quote draft, not a live submission. Sample prices, stock, delivery and installation require retailer confirmation.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Download request <Icon name="download" /></button></div></form>}</div>
  )
}

function App() {
  const [project, renderProject] = useState<ProjectState>(loadProject)
  const projectRef = useRef(project)
  const lastStored = useRef<string | null>(null)
  const history = useRef<{ past: ProjectState[]; future: ProjectState[] }>({ past: [], future: [] })
  const dragSnapshot = useRef<ProjectState | null>(null)
  const [, refreshHistory] = useState(0)
  const setProject = (update: ProjectState | ((current: ProjectState) => ProjectState)) => {
    const current = projectRef.current
    const next = typeof update === 'function' ? update(current) : update
    if (JSON.stringify(current) === JSON.stringify(next)) return
    if (!dragSnapshot.current) {
      history.current.past = [...history.current.past.slice(-49), current]
      history.current.future = []
    }
    projectRef.current = next
    renderProject(next)
  }
  const undo = () => {
    const previous = history.current.past.pop()
    if (!previous) return
    history.current.future.push(projectRef.current)
    projectRef.current = previous
    renderProject(previous)
    clearSelection()
  }
  const redo = () => {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(projectRef.current)
    projectRef.current = next
    renderProject(next)
    clearSelection()
  }
  const endDrag = () => {
    const before = dragSnapshot.current
    if (before && JSON.stringify(before) !== JSON.stringify(projectRef.current)) {
      history.current.past = [...history.current.past.slice(-49), before]
      history.current.future = []
    }
    dragSnapshot.current = null
    setDraggingId(null)
    refreshHistory((v) => v + 1)
  }
  const [renderOpen, setRenderOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [activeTool, setActiveTool] = useState<Tool>(() => project.features.length ? 'select' : 'wall')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [gridVisible, setGridVisible] = useState(true)
  const [snap, setSnap] = useState(true)
  const [wallSnap, setWallSnap] = useState(true)
  const [dragProduct, setDragProduct] = useState<string | null>(null)
  const [retailer, setRetailer] = useState('All')
  const [sort, setSort] = useState('curated')
  const [notice, setNotice] = useState(() => needsRecovery ? 'Saved data could not be loaded. Your original data has not been overwritten.' : '')
  const [wallsTransparent, setWallsTransparent] = useState(true)
  const [cameraVersion, setCameraVersion] = useState(0)
  const [category, setCategory] = useState<CategoryFilter>('All')
  const [search, setSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved just now')
  const [shoppingOpen, setShoppingOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => window.innerWidth > 1000)
  const [rightPanelOpen, setRightPanelOpen] = useState(() => window.innerWidth > 1200)

  useEffect(() => {
    if (needsRecovery) { setSaveStatus('Recovery mode · save manually'); return }
    setSaveStatus('Unsaved changes')
    const timer = window.setTimeout(() => {
      try { const serialized = JSON.stringify(project); localStorage.setItem(STORAGE_KEY, serialized); lastStored.current = serialized; setSaveStatus('Saved on this device') }
      catch { setSaveStatus('Save unavailable — export a backup') }
    }, 700)
    return () => clearTimeout(timer)
  }, [project])
  useEffect(() => {
    try { lastStored.current = localStorage.getItem(STORAGE_KEY) } catch {}
    const persist = () => { if (!needsRecovery) { try { if (localStorage.getItem(STORAGE_KEY) === lastStored.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(projectRef.current)) } catch {} } }
    window.addEventListener('pagehide', persist)
    return () => window.removeEventListener('pagehide', persist)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!shoppingOpen && !newProjectOpen && !requestOpen) return
    const previous = document.activeElement as HTMLElement | null
    const panel = document.querySelector<HTMLElement>('.modal-card, .shopping-drawer')
    const elements = () => Array.from(document.querySelector('.modal-card, .shopping-drawer')?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea') || [])
    const frame = requestAnimationFrame(() => (panel?.querySelector<HTMLElement>('input') || elements()[0])?.focus())
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setShoppingOpen(false); setNewProjectOpen(false); setRequestOpen(false) }
      if (event.key !== 'Tab') return
      const targets = elements(), first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keys)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keys); previous?.focus() }
  }, [shoppingOpen, newProjectOpen, requestOpen])

  const selectedObject = project.objects.find((object) => object.id === selectedId) ?? null
  const selectedProduct = selectedObject ? productById.get(selectedObject.productId) ?? null : null
  const selectedFeature = project.features.find((feature) => feature.id === selectedFeatureId) ?? null

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((product) => (category === 'All' || product.group === category) && (retailer === 'All' || product.retailer === retailer) && (!query || `${product.name} ${product.brand} ${product.category} ${product.retailer} ${product.sku || ''}`.toLowerCase().includes(query))).sort((a, b) => sort === 'price-low' ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === 'price-high' ? (b.price ?? -Infinity) - (a.price ?? -Infinity) : 0)
  }, [category, search, retailer, sort])

  const shoppingItems = useMemo(() => {
    const grouped = new Map<string, { product: Product; quantity: number; subtotal: number }>()
    project.objects.forEach((object) => {
      const product = productById.get(object.productId)
      if (!product) return
      const current = grouped.get(product.id)
      if (current) {
        current.quantity += 1
        current.subtotal += product.price ?? 0
      } else {
        grouped.set(product.id, { product, quantity: 1, subtotal: product.price ?? 0 })
      }
    })
    return [...grouped.values()]
  }, [project.objects])

  const estimatedTotal = shoppingItems.reduce((total, item) => total + item.subtotal, 0)
  const itemCount = project.objects.length
  const warnings = useMemo(() => placementWarnings(project), [project])
  const floors = useMemo(() => getFloorRegions(project.features), [project.features])
  const floorArea = floors.reduce((sum, region) => sum + region.area, 0)

  const clearSelection = () => {
    setSelectedId(null)
    setSelectedFeatureId(null)
  }

  const selectObject = (id: string) => {
    setSelectedId(id)
    setSelectedFeatureId(null)
    setActiveTool('select')
    setRightPanelOpen(true)
    if (window.innerWidth <= 1000) setLeftPanelOpen(false)
  }

  const selectFeature = (id: string) => {
    setSelectedFeatureId(id)
    setSelectedId(null)
    setActiveTool('select')
    setRightPanelOpen(true)
    if (window.innerWidth <= 1000) setLeftPanelOpen(false)
  }

  const patchProject = (patch: Partial<ProjectState>) => setProject((current) => {
    const next = { ...current, ...patch }
    next.width = clamp(next.width, current.width, 40)
    next.length = clamp(next.length, current.length, 40)
    next.ceilingHeight = clamp(next.ceilingHeight, 2, 6)
    return refreshOpenings(next)
  })

  const addProduct = (productId: string, x?: number, z?: number) => {
    const product = productById.get(productId)
    if (!product) return
    const current = projectRef.current, regions = getFloorRegions(current.features)
    setDragProduct(null)
    if (!regions.length) { setNotice('Close a loop of walls first. The floor will fill automatically.'); return }
    const defaultVariantId = product.variants?.[0]?.id
    let object = placeObject({ id: makeId('object'), productId, ...(defaultVariantId ? { variantId: defaultVariantId } : {}), x: x ?? 0, z: z ?? 0, rotation: 0 }, current, snap, wallSnap)
    if (x === undefined) {
      const candidates: RoomObject[] = [object]
      for (let px = -current.width / 2; px <= current.width / 2; px += 0.25) for (let pz = -current.length / 2; pz <= current.length / 2; pz += 0.25) candidates.push(placeObject({ ...object, x: px, z: pz }, current, snap, wallSnap))
      const valid = candidates.filter((candidate) => fitsFloor(candidate, current, regions)).sort((a, b) => a.x ** 2 + a.z ** 2 - b.x ** 2 - b.z ** 2)
      object = valid.find((candidate) => current.objects.every((o) => !overlaps(candidate, o))) || valid[0] || object
    }
    if (!fitsFloor(object, current, regions)) { setNotice('This piece must fit entirely inside an enclosed room.'); return }
    setProject({ ...current, objects: [...current.objects, object] })
    selectObject(object.id)
    setDragProduct(null)
    setNotice(`${product.name} added to your room`)
  }

  const patchObject = (patch: Partial<RoomObject>) => {
    if (!selectedId) return
    const current = projectRef.current, object = current.objects.find((o) => o.id === selectedId)
    if (!object) return
    const next = placeObject({ ...object, ...patch }, current)
    if (!fitsFloor(next, current)) { setNotice('Keep the whole piece inside a closed room, clear of walls.'); return }
    setProject({ ...current, objects: current.objects.map((o) => o.id === selectedId ? next : o) })
  }

  const moveObject = (id: string, x: number, z: number) => {
    setProject((current) => ({ ...current, objects: current.objects.map((candidate) => {
      if (candidate.id !== id) return candidate
      const next = placeObject({ ...candidate, x, z }, current, snap, wallSnap)
      return fitsFloor(next, current, floors) ? next : candidate
    }) }))
  }

  const duplicateSelected = () => {
    if (!selectedObject) return
    let duplicate = placeObject({ ...selectedObject, id: makeId('object'), x: selectedObject.x + 0.35, z: selectedObject.z + 0.35 }, project)
    if (!fitsFloor(duplicate, project)) duplicate = { ...selectedObject, id: duplicate.id }
    if (!fitsFloor(duplicate, project)) { setNotice('Repair the room boundary before duplicating this piece.'); return }
    setProject((current) => ({ ...current, objects: [...current.objects, duplicate] }))
    selectObject(duplicate.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setProject((current) => ({ ...current, objects: current.objects.filter((object) => object.id !== selectedId) }))
    clearSelection()
  }

  const addFeature = (type: FeatureType, x: number, z: number) => {
    if (type === 'wall') return
    const current = projectRef.current
    const feature = attachOpening({ id: makeId(type), type, x, z, rotation: 0, width: type === 'door' ? 0.9 : 1.5, height: type === 'door' ? 2.1 : 1.35, sillHeight: type === 'window' ? 0.85 : 0 }, current)
    if (!feature.wallId || Math.hypot(feature.x - x, feature.z - z) > 0.65) { setNotice(`Click a drawn wall to place the ${type}.`); return }
    if (current.features.some((f) => f.wallId === feature.wallId && Math.abs((f.wallOffset || 0) - (feature.wallOffset || 0)) < (f.width + feature.width) / 2 + 0.05)) { setNotice('That section of wall already contains an opening.'); return }
    setProject({ ...current, features: [...current.features, feature] })
    selectFeature(feature.id)
  }

  const patchFeature = (patch: Partial<RoomFeature>) => {
    if (!selectedFeatureId) return
    setProject((current) => {
      const original = current.features.find((f) => f.id === selectedFeatureId)
      if (!original) return current
      const edited = { ...original, ...patch }
      if (original.type !== 'wall') return refreshOpenings({ ...current, features: current.features.map((f) => f.id === edited.id ? edited : f) })
      const before = wallEndpoints(original), after = wallEndpoints(edited)
      const features = current.features.map((f) => {
        if (f.type !== 'wall') return f
        const ends = wallEndpoints(f).map((p) => { const i = before.findIndex((v) => Math.hypot(v.x - p.x, v.z - p.z) < 0.0001); return i < 0 ? p : after[i] })
        return { ...f, ...wallFromPoints(f.id, ends[0], ends[1], f.id === edited.id ? edited.height : f.height) }
      })
      if (features.some((f) => f.type === 'wall' && (f.width < 0.25 || wallEndpoints(f).some((p) => Math.abs(p.x) > current.width / 2 || Math.abs(p.z) > current.length / 2)))) return current
      return refreshOpenings({ ...current, features })
    })
  }

  const deleteFeature = () => {
    if (!selectedFeatureId) return
    setProject((current) => ({ ...current, features: current.features.filter((feature) => feature.id !== selectedFeatureId && feature.wallId !== selectedFeatureId) }))
    clearSelection()
  }

  const saveProject = () => {
    try {
      if (needsRecovery) {
        const original = localStorage.getItem(STORAGE_KEY)
        if (original) localStorage.setItem(`${STORAGE_KEY}-recovery-${Date.now()}`, original)
      }
      const serialized = JSON.stringify(project)
      window.localStorage.setItem(STORAGE_KEY, serialized)
      lastStored.current = serialized
      needsRecovery = false
      if (window.location.hash.startsWith('#project=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setSaveStatus('Saved on this device')
    } catch {
      setSaveStatus('Save unavailable')
    }
  }

  const exportList = () => {
    const rows = [['Product', 'Brand', 'Retailer', 'SKU', 'Quantity', 'Width cm', 'Depth cm', 'Height cm', 'Unit price EUR', 'Subtotal EUR', 'Verification status']]
    shoppingItems.forEach(({ product, quantity, subtotal }) => rows.push([product.name, product.brand, product.retailer, product.sku || '', String(quantity), String(product.width), String(product.depth), String(product.height), String(product.price ?? ''), String(subtotal), product.status]))
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')
    downloadFile(`${project.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-shopping-list.csv`, csv, 'text/csv;charset=utf-8')
  }

  const shareProject = async () => {
    const shareUrl = new URL(window.location.href)
    shareUrl.hash = `project=${encodeURIComponent(JSON.stringify(project))}`
    try {
      await navigator.clipboard.writeText(shareUrl.toString())
      setNotice('Project link copied. Anyone with the link can open a copy.')
    } catch {
      setNotice('Clipboard unavailable. Save a project backup instead.')
    }
  }

  const drawWall = (x: number, z: number, endX: number, endZ: number) => {
    const current = projectRef.current
    if (current.features.length >= 200) { setNotice('This prototype supports up to 200 walls and openings.'); return }
    const a = snapBuildPoint({ x, z }, current), b = snapBuildPoint({ x: endX, z: endZ }, current)
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.25) return
    const same = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.z - q.z) < 0.001
    if (current.features.filter((f) => f.type === 'wall').some((f) => { const [c, d] = wallEndpoints(f); return (same(a, c) && same(b, d)) || (same(a, d) && same(b, c)) })) return
    const wall = wallFromPoints(makeId('wall'), a, b, current.ceilingHeight)
    const next = { ...current, features: [...current.features, wall] }
    if (getFloorRegions(next.features).length > getFloorRegions(current.features).length) setNotice('Room enclosed. Your floor is ready to furnish.')
    setProject(next)
  }
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (renderOpen || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || shoppingOpen || requestOpen || newProjectOpen) return
      if (event.key === 'Escape') { clearSelection(); setActiveTool('select'); endDrag(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return }
      if (event.key === '/') { event.preventDefault(); setLeftPanelOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search-field input')?.focus()); return }
      if (selectedFeatureId && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteFeature(); return }
      if (event.key.toLowerCase() === 'w') { clearSelection(); setActiveTool('wall'); setViewMode('2d'); return }
      if (!selectedObject) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      if (event.key.toLowerCase() === 'r') patchObject({ rotation: selectedObject.rotation + Math.PI / 12 })
      const delta = event.shiftKey ? 0.1 : 0.01
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        patchObject({ x: selectedObject.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), z: selectedObject.z + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) })
      }
    }
    const finish = () => { if (dragSnapshot.current) endDrag() }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('pointerup', finish)
    window.addEventListener('blur', finish)
    return () => { window.removeEventListener('keydown', handleKey); window.removeEventListener('pointerup', finish); window.removeEventListener('blur', finish) }
  })

  const createProject = (nextProject: ProjectState) => {
    if (window.location.hash.startsWith('#project=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setProject(nextProject)
    clearSelection()
    setNewProjectOpen(false)
    setViewMode('2d')
    setActiveTool('wall')
    setGridVisible(true)
    setCameraVersion((value) => value + 1)
  }

  return (
    <div className="app-shell">
      <header className="topbar" inert={renderOpen || shoppingOpen || newProjectOpen || requestOpen}>
        <div className="brand-lockup"><div className="brand-mark"><span /><span /><span /><span /></div><strong><a href="/" aria-label="Forma home" style={{ color: 'inherit', textDecoration: 'none' }}>FORMA</a></strong><span className="brand-divider" /><button className="project-switcher" onClick={() => setNewProjectOpen(true)}><span>{project.name}</span><Icon name="chevron" size={14} /></button></div>
        <div className="save-indicator"><span className={`save-dot ${saveStatus === 'Unsaved changes' ? 'save-dot-dirty' : ''}`} />{saveStatus}</div>
        <div className="top-actions"><button className="top-icon-button" title="Undo" disabled={!history.current.past.length} onClick={undo}><Icon name="undo" /></button><button className="top-icon-button" title="Redo" disabled={!history.current.future.length} onClick={redo}><Icon name="redo" /></button><span className="top-divider" /><button className="top-action-button" aria-label="Share project" onClick={shareProject}><Icon name="share" /> Share</button><button className="top-action-button" aria-label="Shopping list" onClick={() => setShoppingOpen(true)}><Icon name="shopping" /> List <span className="action-count">{itemCount}</span></button><button className="top-action-button primary-top-action" aria-label="Save project" onClick={saveProject}><Icon name="save" /> Save</button><div className="avatar">V</div></div>
      </header>

      <div className={`editor-layout ${leftPanelOpen ? '' : 'left-collapsed'} ${rightPanelOpen ? '' : 'right-collapsed'}`} inert={renderOpen || shoppingOpen || newProjectOpen || requestOpen}>
        <aside className="sidebar left-sidebar" aria-label="Catalogue and room tools" inert={!leftPanelOpen}>
          <div className="sidebar-scroll">
            <div className="panel-heading"><div><span className="eyebrow">Workspace</span><h1>Build your space</h1></div><button className="icon-button panel-collapse-button" onClick={() => setLeftPanelOpen(false)} title="Collapse tools"><Icon name="panel" /></button></div>
            <div className="tool-grid">
              {([['select', 'Select', 'cube'], ['wall', 'Wall', 'wall'], ['door', 'Door', 'box'], ['window', 'Window', 'window']] as [Tool, string, IconName][]).map(([tool, label, icon]) => <button key={tool} className={`tool-button ${activeTool === tool ? 'tool-button-active' : ''}`} aria-pressed={activeTool === tool} onClick={() => { clearSelection(); setActiveTool(tool); if (tool === 'wall') setViewMode('2d'); if (window.innerWidth <= 1000) setLeftPanelOpen(false) }}><span className="tool-icon"><Icon name={icon} /></span><span>{label}</span></button>)}
            </div>
            {activeTool !== 'select' && <div className="tool-hint"><span className="hint-pip" /><span>{activeTool === 'wall' ? 'Drag on the grid to draw connected walls. Close a loop to fill the floor.' : `Click a drawn wall to add a ${activeTool}.`} Escape to cancel.</span></div>}
            <div className="catalog-heading"><div><span className="eyebrow">Make yourself at home</span><h2>Furniture & objects</h2></div><span className="check-count">{products.length}</span></div><p className="catalog-intro">Drag a piece into your room, or use + to add it.</p>
            <label className="search-field"><Icon name="search" /><input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" /><kbd>/</kbd></label>
            <div className="category-row">{categories.map((item) => <button key={item} className={category === item ? 'category-active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <div className="catalog-filters"><select aria-label="Retailer filter" value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="All">All retailers</option>{[...new Set(products.map((p) => p.retailer))].map((r) => <option key={r}>{r}</option>)}</select><select aria-label="Sort products" value={sort} onChange={(event) => setSort(event.target.value)}><option value="curated">Curated order</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></div>
            <div className="catalog-results"><span>{filteredProducts.length} pieces</span><span>Sample collection</span></div>
            <div className="product-list">{filteredProducts.map((product) => <article className="product-card" key={product.id} draggable onDragStart={(event) => { event.dataTransfer.setData(PRODUCT_DRAG_TYPE, product.id); event.dataTransfer.effectAllowed = 'copy'; setDragProduct(product.id); setActiveTool('select') }} onDragEnd={() => setDragProduct(null)}>
              <ProductThumb product={product} /><div className="product-card-body"><div><span>{product.category}</span><strong>{product.name}</strong><span>{product.retailer}</span><small>{product.width} × {product.depth} × {product.height} cm</small></div><div className="product-card-bottom"><strong>{formatPrice(product.price)}</strong><button className="add-product-button" onClick={() => addProduct(product.id)} title={`Add ${product.name} to room`}><Icon name="plus" size={15} /></button></div></div>
            </article>)}</div>
            {filteredProducts.length === 0 && <div className="empty-search"><span>No products found</span><button className="text-button" onClick={() => { setSearch(''); setCategory('All'); setRetailer('All'); setSort('curated') }}>Clear filters</button></div>}
          </div>
          <div className="sidebar-footer"><button className="footer-link" onClick={() => setNewProjectOpen(true)}><Icon name="plus" /> New project</button><button className="footer-link" onClick={() => setShoppingOpen(true)}><Icon name="shopping" /> Shopping list <span>{formatPrice(estimatedTotal)}</span></button></div>
        </aside>

        <main className="workspace">
          <div className="workspace-toolbar"><div className="workspace-context"><span className="live-dot" />{activeTool === 'wall' ? 'Build mode' : 'Your space'}<span className="context-separator">/</span><span>{floors.length} {floors.length === 1 ? 'room' : 'rooms'} · {floorArea.toFixed(1)} m²</span></div><div className="canvas-actions"><button className="render-launch" disabled={!floors.length} onClick={() => setRenderOpen(true)}>Render studio</button><button className="canvas-action-button" title="Toggle grid" aria-pressed={gridVisible} onClick={() => setGridVisible(!gridVisible)}><Icon name="grid" /> Grid <span className={`toggle ${gridVisible ? 'toggle-on' : ''}`}><span /></span></button><button className="canvas-action-button" title="Toggle wall cutaway" aria-pressed={wallsTransparent} onClick={() => setWallsTransparent(!wallsTransparent)}><Icon name="layers" /> Walls <span className={`toggle ${wallsTransparent ? 'toggle-on' : ''}`}><span /></span></button><span className="canvas-action-divider" /><div className="view-switcher"><button className={viewMode === '3d' ? 'view-active' : ''} onClick={() => setViewMode('3d')}><Icon name="cube" size={14} /> 3D</button><button className={viewMode === '2d' ? 'view-active' : ''} onClick={() => setViewMode('2d')}><Icon name="box" size={14} /> 2D plan</button></div><button className="canvas-icon-button" onClick={() => setCameraVersion((value) => value + 1)} title="Reset camera"><Icon name="rotate" /></button><button className="workspace-collapse-button" onClick={() => setLeftPanelOpen(!leftPanelOpen)} title="Toggle catalogue"><Icon name="panel" /></button></div></div>
          <div className={`canvas-frame ${dragProduct ? 'drop-active' : ''}`} data-drag-product={dragProduct || ''} data-room-count={floors.length} data-floor-area={floorArea.toFixed(2)} data-wall-count={project.features.filter((f) => f.type === 'wall').length}><RoomScene project={project} viewMode={viewMode} gridVisible={gridVisible} wallsTransparent={wallsTransparent} selectedId={selectedId} selectedFeatureId={selectedFeatureId} activeTool={activeTool} draggingId={draggingId} cameraVersion={cameraVersion} onClearSelection={clearSelection} onSelectObject={selectObject} onSelectFeature={selectFeature} onPlaceFeature={addFeature} onMoveObject={moveObject} onDragStart={(id) => { dragSnapshot.current = projectRef.current; setDraggingId(id) }} onDragEnd={endDrag} snap={snap} wallSnap={wallSnap} onDropProduct={addProduct} onDrawWall={drawWall} onMoveEndpoint={(id, previous, next) => setProject((current) => moveWallEndpoint(current, id, previous, next))} /><div className="canvas-label"><span className="canvas-label-number">01</span><span>{viewMode === '3d' ? 'Isometric view' : 'Floor plan'}</span><span className="canvas-label-dot" /><span>{activeTool === 'wall' ? 'Build grid · 25 cm' : 'Real dimensions · metres'}</span></div>{!project.features.length && !dragProduct && <div className="empty-build-hint"><strong>Your space starts here</strong><span>Drag your first wall on the grid.<br />Connect the walls to create a floor.</span></div>}{dragProduct && <div className="drop-prompt">{floors.length ? 'Drop inside your space' : 'Close your walls before furnishing'}</div>}<div className="canvas-tip">{activeTool === 'wall' ? 'Drag to draw · Shift for straight walls · Esc to select' : activeTool !== 'select' ? `Click a wall to add a ${activeTool}` : selectedObject ? 'Drag to move · R to rotate · Arrows to nudge' : viewMode === '3d' ? 'Drag empty space to orbit · Right-drag to pan · Scroll to zoom' : 'Right-drag to pan · Scroll to zoom'}</div><div className="placement-controls">{activeTool === 'wall' ? <span className="build-grid-label">Wall grid · 25 cm · Corners snap together</span> : <><button aria-pressed={snap} onClick={() => setSnap(!snap)}>Snap · 10 cm <span className={`toggle ${snap ? 'toggle-on' : ''}`}><span /></span></button><button aria-pressed={wallSnap} onClick={() => setWallSnap(!wallSnap)}>To walls <span className={`toggle ${wallSnap ? 'toggle-on' : ''}`}><span /></span></button></>}</div>{selectedObject && <div className="selection-toolbar"><button title="Rotate selected product" onClick={() => patchObject({ rotation: selectedObject.rotation + Math.PI / 12 })}><Icon name="rotate" />15°</button><button title="Duplicate selected product" onClick={duplicateSelected}><Icon name="copy" /></button><button title="Delete selected product" onClick={deleteSelected}><Icon name="trash" /></button></div>}</div>
          <div className="layer-strip"><div className="layer-card layer-plan"><div className="layer-card-heading"><span className="layer-number">01</span><div><strong>Floor plan</strong><span>Live room layout</span></div><button className="layer-open-button" onClick={() => setViewMode('2d')}><Icon name="arrow" size={14} /></button></div><FloorPlanPreview project={project} /></div><div className="layer-card layer-materials"><div className="layer-card-heading"><span className="layer-number">02</span><div><strong>Material palette</strong><span>Neutral foundation</span></div></div><div className="palette-row"><span className="palette-swatch palette-floor" style={{ background: floorColors[project.floorMaterial] }} /><span className="palette-swatch palette-wall" style={{ background: wallColors[project.wallMaterial] }} /><span className="palette-swatch palette-linen" /><span className="palette-swatch palette-olive" /><span className="palette-swatch palette-charcoal" /></div><div className="palette-labels"><span>{project.floorMaterial}</span><span>{project.wallMaterial}</span></div></div><div className="layer-card layer-summary"><div className="layer-card-heading"><span className="layer-number">03</span><div><strong>Project summary</strong><span>{saveStatus}</span></div></div><div className="summary-grid"><div><strong>{floorArea.toFixed(1)} m²<small>enclosed floor</small></strong></div><div><strong>{itemCount}<small>products</small></strong></div><div><strong>{formatPrice(estimatedTotal)}<small>estimated total</small></strong></div></div></div></div>
        </main>

        <aside className="sidebar right-sidebar" aria-label="Properties" inert={!rightPanelOpen}>
          <div className="sidebar-scroll"><div className="inspector-topline"><span className="eyebrow">Inspector</span><button className="icon-button panel-collapse-button" onClick={() => setRightPanelOpen(false)} title="Collapse inspector"><Icon name="panel" /></button></div>{selectedProduct && selectedObject ? <ObjectProperties onClose={clearSelection} object={selectedObject} product={selectedProduct} onPatch={patchObject} onRotate={() => patchObject({ rotation: selectedObject.rotation + Math.PI / 12 })} onDuplicate={duplicateSelected} onDelete={deleteSelected} /> : selectedFeature ? <FeatureProperties project={project} feature={selectedFeature} onPatch={patchFeature} onDelete={deleteFeature} /> : <RoomProperties project={project} onPatch={patchProject} />}{selectedObject && warnings.length > 0 && <section className="inspector-section"><div className="section-label-row"><span>Placement checks</span></div>{warnings.map((warning, index) => <div className="health-row warning" key={index}>{warning.message}</div>)}</section>}</div>
          <div className="sidebar-footer inspector-footer"><button className="footer-link" onClick={() => setShoppingOpen(true)}><Icon name="shopping" /><span>Review shopping list</span><strong>{formatPrice(estimatedTotal)}</strong></button></div>
        </aside>
      </div>

      {!leftPanelOpen && !shoppingOpen && !newProjectOpen && !requestOpen && !renderOpen && <button className="floating-panel-button floating-left" onClick={() => { setLeftPanelOpen(true); if (window.innerWidth <= 1200) setRightPanelOpen(false) }} title="Open catalogue" aria-label="Open catalogue"><Icon name="panel" /><span>Catalogue</span></button>}
      {!rightPanelOpen && !shoppingOpen && !newProjectOpen && !requestOpen && !renderOpen && <button className="floating-panel-button floating-right" onClick={() => setRightPanelOpen(true)} title="Open inspector" aria-label="Open inspector"><Icon name="panel" /><span>Inspector</span></button>}
      {renderOpen && <Suspense fallback={<div className="render-loading" role="status">Loading render studio… <button onClick={() => setRenderOpen(false)}>Back to editor</button></div>}><RenderStudio project={project} onClose={() => setRenderOpen(false)} /></Suspense>}
      {!renderOpen && notice && <div className="toast" role="status">{notice}</div>}
      {shoppingOpen && <ShoppingDrawer items={shoppingItems} total={estimatedTotal} onClose={() => setShoppingOpen(false)} onExport={exportList} onRequest={() => { setShoppingOpen(false); setRequestOpen(true) }} />}
      {newProjectOpen && <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreate={createProject} />}
      {requestOpen && <PurchaseRequestModal project={project} total={estimatedTotal} onClose={() => setRequestOpen(false)} />}
    </div>
  )
}

export default App
