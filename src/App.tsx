import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SurfaceMaterial from './SurfaceMaterial'

const RenderStudio = lazy(() => import('./RenderStudio'))
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Html, Line, OrbitControls, PerspectiveCamera, RoundedBox, useGLTF } from '@react-three/drei'
import SceneEnvironment, { Architecture, BUILD_TOOLS, GRID_TOOLS, type BuildAction, type EditorLightingMode } from './SceneEnvironment'
import { wallsFromSketch } from './sketch'
import MeasureRoom from './MeasureRoom'
import AddItemSheet from './AddItemSheet'
import OpeningOptions from './OpeningOptions'
import { formatPrice, Icon, ProductThumb, type IconName } from './ui'
import { analyzePlanFile, createProjectFromPlan, type PlanAnalysis, type PixelPoint, type PixelWall, type PixelOpening, type PlanCalibration, type PlanDetectionProvider } from './planImport'
import { ACESFilmicToneMapping, CatmullRomCurve3, DoubleSide, Group, MOUSE, OrthographicCamera, PerspectiveCamera as ThreePerspectiveCamera, Plane, TOUCH, Vector3 } from 'three'
import { activeTouchCount, angleStep, beyondSlop, cancelOnMultiTouch, classifyTwoFinger, fingerAngle, fingerMidpoint, fingerSpan, snapRotation, TAP_MAX_TRAVEL_PX, type ScreenPoint, type TwoFinger, type TwoFingerMode } from './gestures'
import type { ThreeEvent } from '@react-three/fiber'
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import { getToken } from 'firebase/app-check'
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { accountApi, AccountApiError, cloudProjectKey, type SavedProject, type SavedProjectDetails } from './account'
import { purchaseItemId } from './purchase'
import { appCheck, auth } from './firebase'
import { products, type CategoryFilter, type Product } from './catalog'
import { attachOpening, clamp, emptyProject, fitsFloor, floorColors, getFloorRegions, isProject, migrateProject, moveWallEndpoint, overlaps, addWallSegment, eraseWallSegment, hangOnWall, isWallMounted, placeObject, setWallLength, placementWarnings, pointInPolygon, productById, refreshOpenings, rotateObjects, roomItemShape, snapBuildPoint, wallColors, wallEndpoints, wallFromPoints, wallThickness, type CustomRoomItem, type Point, type ProjectState, type RoomFeature, type RoomObject } from './editor'

type ViewMode = '3d' | '2d'
type LightingMode = EditorLightingMode
type Tool = 'select' | 'wall' | 'room' | 'erase' | 'sketch' | 'door' | 'window'
type FeatureType = 'wall' | 'door' | 'window'
type Step = 'room' | 'furnish' | 'review'


const FLOOR = new Plane(new Vector3(0, 1, 0), 0)
// OrbitControls treats an unknown button/touch action as "do nothing".
const NO_ACTION = -1 as number
const PRODUCT_DRAG_TYPE = 'application/x-forma-product'

const STORAGE_KEY = 'forma-room-planner-project'
let needsRecovery = false

const categories: CategoryFilter[] = ['All', 'Seating', 'Tables', 'Lighting', 'Decor', 'Storage', 'Bedroom', 'Kitchen', 'Bathroom']

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
    if (parsed.schemaVersion === undefined && !shared && saved) localStorage.setItem(`${STORAGE_KEY}-before-custom-spaces`, saved)
    if (parsed.schemaVersion === 2 && !shared && saved) localStorage.setItem(`${STORAGE_KEY}-before-explicit-basket`, saved)
    return migrateProject(parsed)
  } catch {
    needsRecovery = true
    return emptyProject()
  }
}

const COMPACT_QUERY = '(max-width: 900px)'
function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY), update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`
}


const requestPlanDetection: PlanDetectionProvider = async (request) => {
  if (!auth || !appCheck) throw new Error('Firebase Auth and App Check are not configured for AI plan detection.')
  const user = auth.currentUser || (await signInAnonymously(auth)).user
  const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), getToken(appCheck)])
  const response = await fetch('/api/planner/detect-floor-plan', { method: 'POST', headers: { authorization: `Bearer ${idToken}`, 'x-firebase-appcheck': appCheckToken.token, 'content-type': 'application/json' }, body: JSON.stringify(request) })
  const result = await response.json() as Awaited<ReturnType<PlanDetectionProvider>> & { error?: string }
  if (!response.ok) throw new Error(result.error || `AI plan detection failed (${response.status}).`)
  return result
}

function downloadFile(name: string, content: string, type: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}



// Publishes the plan-view mapping (camera centre and pixels per metre) so browser tests can tap real plan coordinates.
function PlanProbe({ viewMode }: { viewMode: ViewMode }) {
  const { camera, gl } = useThree()
  useFrame(() => {
    const data = gl.domElement.dataset
    if (viewMode === '2d' && camera instanceof OrthographicCamera) Object.assign(data, { planX: camera.position.x.toFixed(4), planZ: camera.position.z.toFixed(4), planZoom: camera.zoom.toFixed(4) })
    else { delete data.planX; delete data.planZ; delete data.planZoom }
  })
  return null
}

function CameraRig({ viewMode, cameraVersion, project, fitRooms, floorCount }: { viewMode: ViewMode; cameraVersion: number; project: ProjectState; fitRooms: boolean; floorCount: number }) {
  const { camera, size, controls, invalidate } = useThree()
  const latest = useRef(project)
  latest.current = project
  useEffect(() => {
    const orbit = controls as unknown as { target: Vector3; update: () => void } | null
    const points = latest.current.features.filter((f) => f.type === 'wall').flatMap(wallEndpoints)
    // Plan view frames the drawn rooms, except while drawing walls, which needs the whole build grid.
    const roomFit = viewMode === '2d' && fitRooms && points.length > 0
    const fitted = (viewMode === '3d' || roomFit) && points.length > 0
    const minX = fitted ? Math.min(...points.map((p) => p.x)) : -project.width / 2, maxX = fitted ? Math.max(...points.map((p) => p.x)) : project.width / 2
    const minZ = fitted ? Math.min(...points.map((p) => p.z)) : -project.length / 2, maxZ = fitted ? Math.max(...points.map((p) => p.z)) : project.length / 2
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, w = Math.max(3, maxX - minX), l = Math.max(3, maxZ - minZ)
    const targetY = viewMode === '2d' ? 0 : project.ceilingHeight * 0.24
    orbit?.target.set(cx, targetY, cz)
    if (camera instanceof ThreePerspectiveCamera) {
      const distance = Math.max(9, Math.hypot(w, l) * 1.65)
      camera.fov = 50
      camera.aspect = size.width / Math.max(1, size.height)
      camera.position.set(cx + distance * 0.62, targetY + Math.max(project.ceilingHeight * 1.8, distance * 0.55), cz + distance * 0.78)
      camera.lookAt(cx, targetY, cz)
      camera.updateProjectionMatrix()
    } else {
      camera.position.set(...(viewMode === '2d' ? [cx, 12, cz + 0.001] : [cx + 8, 7.5 + targetY, cz + 10]) as [number, number, number])
      camera.lookAt(cx, targetY, cz)
      const cam = camera as OrthographicCamera
      if (roomFit) {
        // Desktop keeps the right-hand strip free for the inspector card and shifts the room left; vertical margins clear the mobile top buttons and bottom bar.
        const inspector = size.width >= 760 ? 380 : 0
        cam.zoom = clamp(Math.min(Math.max(120, size.width - 48 - inspector) / (w + 1), Math.max(120, size.height - 190) / (l + 1)), 1, 250)
        const shift = inspector / 2 / cam.zoom
        camera.position.x += shift
        orbit?.target.set(cx + shift, targetY, cz)
      } else {
      const spanX = viewMode === '2d' ? project.width + 1.2 : (w + l) * 0.8 + 1
      const spanY = viewMode === '2d' ? project.length + 1.8 : (w + l) * 0.46 + project.ceilingHeight * 0.85 + 0.8
      cam.zoom = Math.min(size.width / spanX, size.height / spanY)
      }
      cam.updateProjectionMatrix()
    }
    orbit?.update()
    invalidate()
  }, [camera, controls, size.width, size.height, cameraVersion, viewMode, project.width, project.length, project.ceilingHeight, invalidate, fitRooms, floorCount])
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
  const fabric = product.group === 'Seating' || product.category === 'Rug' || product.category === 'Bed'
  const material = <SurfaceMaterial kind={fabric ? 'linen' : 'oak'} color={product.tone} />
  const darkMaterial = <SurfaceMaterial kind="oak" color={product.accent} />
  const ceramicMaterial = <meshPhysicalMaterial color={product.tone} roughness={0.2} clearcoat={0.35} />
  const steelMaterial = <meshStandardMaterial color={product.accent} roughness={0.25} metalness={0.8} />
  const glassMaterial = <meshPhysicalMaterial color={product.tone} transparent opacity={0.24} transmission={0.7} roughness={0.08} side={DoubleSide} />
  const waterMaterial = <meshPhysicalMaterial color="#8fc6c8" transparent opacity={0.72} transmission={0.35} roughness={0.08} />

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

  if (product.category === 'Bed') {
    return (
      <group>
        <RoundedBox args={[width * 0.96, 0.18, depth * 0.94]} radius={0.035} position={[0, 0.14, 0]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.91, height * 0.18, depth * 0.88]} radius={0.07} position={[0, height * 0.32, depth * 0.015]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.93, height * 0.84, depth * 0.08]} radius={0.045} position={[0, height * 0.43, -depth * 0.43]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.88, 0.045, depth * 0.42]} radius={0.02} position={[0, height * 0.43, depth * 0.2]} castShadow receiveShadow>{material}</RoundedBox>
        {[-1, 1].map((side) => <group key={side} position={[side * width * 0.22, height * 0.47, -depth * 0.27]}><Cushion width={width * 0.31} height={height * 0.1} depth={depth * 0.24} color={product.tone} /></group>)}
      </group>
    )
  }

  if (product.category === 'Nightstand') {
    return (
      <group>
        <RoundedBox args={[width * 0.88, height * 0.72, depth * 0.82]} radius={0.025} position={[0, height * 0.4, 0]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.96, 0.06, depth * 0.9]} radius={0.018} position={[0, height * 0.79, 0]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.7, height * 0.18, 0.025]} radius={0.01} position={[0, height * 0.43, depth * 0.42]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * width * 0.33, height * 0.14, z * depth * 0.3]} castShadow><cylinderGeometry args={[0.018, 0.018, height * 0.28, 10]} />{darkMaterial}</mesh>))}
      </group>
    )
  }

  if (product.category === 'Toilet') {
    return (
      <group>
        <RoundedBox args={[width * 0.76, height * 0.3, depth * 0.52]} radius={0.07} position={[0, height * 0.2, depth * 0.1]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.72, 0.04, depth * 0.47]} radius={0.025} position={[0, height * 0.39, depth * 0.1]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.73, height * 0.65, depth * 0.25]} radius={0.035} position={[0, height * 0.54, -depth * 0.28]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <mesh position={[0, height * 0.83, -depth * 0.28]} castShadow><cylinderGeometry args={[width * 0.07, width * 0.07, 0.012, 20]} />{steelMaterial}</mesh>
      </group>
    )
  }

  if (product.category === 'Shower') {
    return (
      <group>
        <mesh position={[0, 0.04, 0]} receiveShadow><boxGeometry args={[width * 0.94, 0.08, depth * 0.94]} />{ceramicMaterial}</mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * width * 0.46, height * 0.44, 0]} castShadow receiveShadow><boxGeometry args={[0.025, height * 0.84, depth * 0.9]} />{glassMaterial}</mesh>)}
        <mesh position={[0, height * 0.44, -depth * 0.46]} castShadow receiveShadow><boxGeometry args={[width * 0.9, height * 0.84, 0.025]} />{glassMaterial}</mesh>
        {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * width * 0.46, height * 0.43, z * depth * 0.46]} castShadow><cylinderGeometry args={[0.018, 0.018, height * 0.86, 12]} />{steelMaterial}</mesh>))}
        <mesh position={[0, height * 0.86, -depth * 0.46]} castShadow><boxGeometry args={[width * 0.92, 0.025, 0.025]} />{steelMaterial}</mesh>
        <mesh position={[0, height * 0.69, -depth * 0.28]} castShadow><cylinderGeometry args={[0.012, 0.012, height * 0.24, 12]} />{steelMaterial}</mesh>
        <mesh position={[0, height * 0.82, -depth * 0.28]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.07, 0.07, 0.025, 24]} />{steelMaterial}</mesh>
      </group>
    )
  }

  if (product.category === 'Bathtub') {
    return (
      <group>
        <RoundedBox args={[width * 0.9, height * 0.35, depth * 0.82]} radius={0.09} position={[0, height * 0.23, 0]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.96, 0.07, depth * 0.88]} radius={0.025} position={[0, height * 0.48, 0]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <mesh position={[0, height * 0.44, 0]} receiveShadow><boxGeometry args={[width * 0.76, 0.012, depth * 0.62]} />{waterMaterial}</mesh>
        <mesh position={[width * 0.35, height * 0.52, -depth * 0.2]} castShadow><cylinderGeometry args={[0.012, 0.012, height * 0.18, 12]} />{steelMaterial}</mesh>
        <mesh position={[width * 0.35, height * 0.6, -depth * 0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.12, 18]} />{steelMaterial}</mesh>
      </group>
    )
  }

  if (product.category === 'Bathroom vanity') {
    return (
      <group>
        <RoundedBox args={[width * 0.92, height * 0.68, depth * 0.8]} radius={0.025} position={[0, height * 0.35, 0]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.98, 0.08, depth * 0.88]} radius={0.018} position={[0, height * 0.72, 0]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <RoundedBox args={[width * 0.46, 0.09, depth * 0.36]} radius={0.04} position={[0, height * 0.79, 0.02]} castShadow receiveShadow>{ceramicMaterial}</RoundedBox>
        <mesh position={[0, height * 0.78, -depth * 0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, 0.16, 12]} />{steelMaterial}</mesh>
        <RoundedBox args={[width * 0.62, height * 0.06, 0.025]} radius={0.008} position={[0, height * 0.4, depth * 0.41]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
      </group>
    )
  }

  if (product.category === 'Kitchen counter' || product.category === 'Kitchen island') {
    const island = product.category === 'Kitchen island'
    return (
      <group>
        <RoundedBox args={[width * 0.96, height * 0.82, depth * 0.82]} radius={0.025} position={[0, height * 0.41, 0]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width, 0.08, depth]} radius={0.018} position={[0, height - 0.04, 0]} castShadow receiveShadow>{darkMaterial}</RoundedBox>
        {!island && <RoundedBox args={[width * 0.96, height * 0.28, 0.05]} radius={0.008} position={[0, height * 0.82, -depth * 0.46]} castShadow receiveShadow>{material}</RoundedBox>}
        {[-1, 0, 1].map((side) => <RoundedBox key={side} args={[width * 0.28, height * 0.54, 0.025]} radius={0.01} position={[side * width * 0.31, height * 0.39, depth * 0.42]} castShadow receiveShadow>{material}</RoundedBox>)}
        {[-1, 0, 1].map((side) => <mesh key={side} position={[side * width * 0.31, height * 0.48, depth * 0.44]} castShadow><cylinderGeometry args={[0.012, 0.012, width * 0.1, 10]} />{steelMaterial}</mesh>)}
        {!island && <RoundedBox args={[width * 0.24, 0.018, depth * 0.46]} radius={0.008} position={[-width * 0.23, height * 0.86, 0]} castShadow receiveShadow>{steelMaterial}</RoundedBox>}
      </group>
    )
  }

  if (product.category === 'Refrigerator') {
    return (
      <group>
        <RoundedBox args={[width * 0.9, height * 0.96, depth * 0.9]} radius={0.025} position={[0, height * 0.48, 0]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.86, height * 0.36, 0.025]} radius={0.008} position={[0, height * 0.78, depth * 0.46]} castShadow receiveShadow>{material}</RoundedBox>
        <RoundedBox args={[width * 0.86, height * 0.53, 0.025]} radius={0.008} position={[0, height * 0.32, depth * 0.46]} castShadow receiveShadow>{material}</RoundedBox>
        {[-1, 1].map((side) => <mesh key={side} position={[side * width * 0.22, height * 0.57, depth * 0.48]} castShadow><cylinderGeometry args={[0.012, 0.012, height * 0.38, 10]} />{steelMaterial}</mesh>)}
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

  // Wall items: back face on the wall (−Z), front toward the room (+Z), bottom edge at Y = 0.
  if (product.category === 'Wall art') return <group>
    <RoundedBox args={[width, height, depth]} radius={0.006} smoothness={2} position={[0, height / 2, 0]} castShadow receiveShadow><meshStandardMaterial color={product.accent} roughness={0.55} /></RoundedBox>
    <mesh position={[0, height / 2, depth / 2 + 0.001]}><planeGeometry args={[width - 0.07, height - 0.07]} /><meshStandardMaterial color="#f4efe4" roughness={0.9} /></mesh>
    <mesh position={[0, height * 0.42, depth / 2 + 0.002]}><planeGeometry args={[width - 0.16, (height - 0.16) * 0.42]} /><meshStandardMaterial color={product.tone} roughness={0.85} /></mesh>
    <mesh position={[0, height * 0.68, depth / 2 + 0.002]}><planeGeometry args={[width - 0.16, (height - 0.16) * 0.38]} /><meshStandardMaterial color="#c9d3cf" roughness={0.85} /></mesh>
  </group>
  if (product.category === 'Mirror') return <group position={[0, height / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[width / 2, width / 2, depth, 64]} /><meshStandardMaterial color={product.accent} roughness={0.35} metalness={0.7} /></mesh>
    <mesh position={[0, depth / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[width / 2 - 0.025, 64]} /><meshStandardMaterial color={product.tone} roughness={0.04} metalness={1} /></mesh>
  </group>
  if (product.category === 'Wall shelf') return <RoundedBox args={[width, height, depth]} radius={0.008} smoothness={2} position={[0, height / 2, 0]} castShadow receiveShadow>{material}</RoundedBox>
  if (product.category === 'Wall TV') return <group>
    <RoundedBox args={[width, height, depth]} radius={0.008} smoothness={2} position={[0, height / 2, 0]} castShadow receiveShadow><meshStandardMaterial color={product.accent} roughness={0.4} metalness={0.3} /></RoundedBox>
    <mesh position={[0, height / 2 + 0.01, depth / 2 + 0.001]}><planeGeometry args={[width - 0.03, height - 0.05]} /><meshStandardMaterial color={product.tone} roughness={0.12} metalness={0.2} /></mesh>
  </group>
  if (product.category === 'Wall cabinet') return <group>
    <RoundedBox args={[width, height, depth * 0.94]} radius={0.01} smoothness={2} position={[0, height / 2, -depth * 0.03]} castShadow receiveShadow>{material}</RoundedBox>
    {[-1, 1].map((side) => <group key={side}>
      <RoundedBox args={[width / 2 - 0.006, height - 0.006, 0.02]} radius={0.004} smoothness={2} position={[side * width / 4, height / 2, depth / 2 - 0.01]} castShadow receiveShadow>{material}</RoundedBox>
      <mesh position={[side * 0.035, 0.07, depth / 2 + 0.008]} castShadow><boxGeometry args={[0.012, 0.09, 0.012]} />{steelMaterial}</mesh>
    </group>)}
  </group>

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

function FurnitureLoading({ width, depth, color }: { width: number; depth: number; color: string }) {
  return <>
    <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, 0.08, depth]} />
      <meshStandardMaterial color={color} transparent opacity={0.45} roughness={1} />
    </mesh>
    <Html center position={[0, 0.36, 0]} style={{ pointerEvents: 'none' }}>
      <span className="object-loading" role="status" aria-label="Loading furniture model" />
    </Html>
  </>
}

function FurnitureObject({
  object,
  product,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  viewMode,
  selectable,
  cutaway,
}: {
  cutaway: boolean
  selectable: boolean
  viewMode: ViewMode
  object: RoomObject
  product: Product | null
  selected: boolean
  onSelect: (extend: boolean) => void
  onDragStart: () => void
  onDragMove: (x: number, z: number, y?: number) => void
  onDragEnd: () => void
  onDragCancel: () => void
}) {
  const item = roomItemShape(object)!
  const wallMounted = isWallMounted(object), elevation = object.elevation ?? 0
  // With "lower front walls" on, a wall item whose wall stands between the camera and the item would float in mid-air, so hide it.
  const groupRef = useRef<Group>(null)
  useFrame(({ camera }) => {
    const group = groupRef.current
    if (!group) return
    const behind = cutaway && wallMounted && viewMode === '3d' && (camera.position.x - object.x) * Math.sin(object.rotation) + (camera.position.z - object.z) * Math.cos(object.rotation) < 0
    group.visible = !behind
  })
  const width = item.width / 100, depth = item.depth / 100, height = item.height / 100
  // In 3D, wall items drag on their wall's vertical plane (along and up/down); everything else drags on the floor.
  const drag = useRef<{ x: number; z: number; y: number; plane: Plane; start: ScreenPoint; moved: boolean; release: () => void } | null>(null)
  const tapToSelect = useRef(false)
  const { controls, gl } = useThree()
  const setControls = (enabled: boolean) => { if (controls) (controls as unknown as { enabled: boolean }).enabled = enabled }
  const finish = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    event.stopPropagation()
    drag.current.release()
    drag.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    gl.domElement.style.cursor = 'grab'
    onDragEnd()
  }
  return (
    <group ref={groupRef} position={[object.x, viewMode === '3d' ? elevation : 0, object.z]} rotation={[0, object.rotation, 0]} scale={[object.mirrored ? -1 : 1, 1, 1]}
      onClick={(event) => {
        if (!selectable) return
        event.stopPropagation()
        if (tapToSelect.current && event.delta <= TAP_MAX_TRAVEL_PX) onSelect(false)
        tapToSelect.current = false
      }}
      onPointerOver={(event) => { if (selectable) { event.stopPropagation(); gl.domElement.style.cursor = 'grab' } }}
      onPointerOut={() => { if (!drag.current) gl.domElement.style.cursor = 'auto' }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !selectable) return
        const touch = event.pointerType === 'touch'
        tapToSelect.current = touch && !selected
        // Touch: the first tap only selects, and a finger on an unselected item moves the camera instead.
        if (touch && (!selected || activeTouchCount() > 1)) return
        const plane = wallMounted && viewMode === '3d' ? new Plane().setFromNormalAndCoplanarPoint(new Vector3(Math.sin(object.rotation), 0, Math.cos(object.rotation)), new Vector3(object.x, 0, object.z)) : FLOOR
        const point = event.ray.intersectPlane(plane, new Vector3())
        if (!point) return
        event.stopPropagation()
        const target = event.target as Element, pointerId = event.pointerId
        const release = touch ? cancelOnMultiTouch(() => {
          drag.current = null
          target.releasePointerCapture?.(pointerId)
          setControls(true)
          onDragCancel()
        }) : () => undefined
        drag.current = { x: point.x - object.x, z: point.z - object.z, y: point.y - elevation, plane, start: { x: event.clientX, y: event.clientY }, moved: !touch, release }
        target.setPointerCapture?.(pointerId)
        setControls(false)
        gl.domElement.style.cursor = 'grabbing'
        onSelect(event.shiftKey || event.ctrlKey || event.metaKey)
        onDragStart()
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        event.stopPropagation()
        if (!drag.current.moved && !(drag.current.moved = beyondSlop(drag.current.start, { x: event.clientX, y: event.clientY }))) return
        const point = event.ray.intersectPlane(drag.current.plane, new Vector3())
        if (point) onDragMove(point.x - drag.current.x, point.z - drag.current.z, drag.current.plane === FLOOR ? undefined : point.y - drag.current.y)
      }}
      onPointerUp={finish} onPointerCancel={finish}
    >
      {viewMode === '2d' ? <mesh position={[0, item.category === 'Rug' ? 0.015 : wallMounted ? 0.13 : 0.06, wallMounted ? Math.max(0, 0.08 - depth) / 2 : 0]}><boxGeometry args={[width, 0.02, wallMounted ? Math.max(depth, 0.08) : depth]} /><meshBasicMaterial color={item.tone} transparent opacity={item.category === 'Rug' ? 0.4 : 0.9} /><Edges color={selected ? '#507759' : '#8f9788'} lineWidth={1} /></mesh> : product ? <Suspense fallback={<FurnitureLoading width={width} depth={depth} color={item.tone} />}><ProductModel product={product} variantId={object.variantId} /></Suspense> : <RoundedBox position={[0, height / 2, 0]} args={[width, height, depth]} radius={Math.min(0.035, height / 4)} smoothness={2} castShadow receiveShadow><meshStandardMaterial color={item.tone} roughness={0.9} /></RoundedBox>}
      {object.inBasket && <Html position={[0, (viewMode === '3d' ? height : 0.1) + 0.14, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className="basket-badge" title="In basket"><Icon name="shopping" size={13} /></span></Html>}
      {selected && <>
        <Line points={[[-width / 2 - 0.04, 0.045, -depth / 2 - 0.04], [width / 2 + 0.04, 0.045, -depth / 2 - 0.04], [width / 2 + 0.04, 0.045, depth / 2 + 0.04], [-width / 2 - 0.04, 0.045, depth / 2 + 0.04], [-width / 2 - 0.04, 0.045, -depth / 2 - 0.04]]} color="#517e68" lineWidth={2} raycast={() => null} />
        <Html position={[0, 0.05, depth / 2 + 0.18]} center style={{ pointerEvents: 'none' }}><span className="dimension-tag">{item.width} × {item.depth} cm</span></Html>
      </>}
    </group>
  )
}

function RoomScene({
  project,
  viewMode,
  gridVisible,
  wallsTransparent,
  selectedIds,
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
  onDragCancel,
  addPoint,
  onAddAt,
  snap, wallSnap, lightingMode, onDropProduct, onBuild, sketch, onErase, onEditLength, onMoveEndpoint, onMoveOpening,
}: {
  onDragCancel: () => void
  addPoint: Point | null
  onAddAt: (x: number, z: number) => void
  onMoveEndpoint: (id: string, previous: Point, next: Point) => void
  onMoveOpening: (id: string, wallOffset: number) => void
  snap: boolean
  wallSnap: boolean
  lightingMode: LightingMode
  onDropProduct: (id: string, x: number, z: number) => void
  onBuild: (action: BuildAction) => void
  sketch: Point[][]
  onErase: (id: string) => void
  onEditLength: (id: string) => void
  project: ProjectState
  viewMode: ViewMode
  gridVisible: boolean
  wallsTransparent: boolean
  selectedIds: string[]
  selectedFeatureId: string | null
  activeTool: Tool
  draggingId: string | null
  cameraVersion: number
  onClearSelection: () => void
  onSelectObject: (id: string, extend: boolean) => void
  onSelectFeature: (id: string, point?: Point) => void
  onPlaceFeature: (type: FeatureType, x: number, z: number) => void
  onMoveObject: (id: string, x: number, z: number, y?: number) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  const floorCount = useMemo(() => getFloorRegions(project.features).length, [project.features])
  // Build tools draw with one finger / the left button, so the camera turns with two fingers / the right button instead.
  const building = BUILD_TOOLS.includes(activeTool)
  return (
    <Canvas shadows orthographic frameloop="demand" dpr={[1, 1.5]}
      camera={{ position: [8, 8, 10], zoom: 65, near: 0.1, far: 150 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping }} onPointerMissed={() => { if (!draggingId && activeTool === 'select') onClearSelection() }}>
      {viewMode === '3d' && <PerspectiveCamera makeDefault position={[8, 8, 10]} fov={50} near={0.03} far={150} />}
      <OrbitControls makeDefault enabled={!draggingId} enableRotate={viewMode === '3d' && (activeTool === 'select' || building)} enableDamping dampingFactor={0.12} minDistance={0.2} maxDistance={100} minZoom={1} maxZoom={250} minPolarAngle={viewMode === '2d' ? 0 : 0.1} maxPolarAngle={Math.PI / 2.1} mouseButtons={building ? viewMode === '3d' ? { LEFT: NO_ACTION as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE } : { LEFT: NO_ACTION as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} touches={{ ONE: building ? NO_ACTION as TOUCH : viewMode === '2d' && activeTool === 'select' ? TOUCH.PAN : TOUCH.ROTATE, TWO: building && viewMode === '3d' ? TOUCH.DOLLY_ROTATE : TOUCH.DOLLY_PAN }} />
      <CameraRig project={project} viewMode={viewMode} cameraVersion={cameraVersion} fitRooms={!GRID_TOOLS.includes(activeTool) && floorCount > 0} floorCount={floorCount} />
      <PlanProbe viewMode={viewMode} />
      <SceneEnvironment project={project} viewMode={viewMode} gridVisible={gridVisible} tool={activeTool} snap={snap} wallSnap={wallSnap} lightingMode={lightingMode} onClear={onClearSelection} onPlace={onPlaceFeature} onDrop={onDropProduct} onBuild={onBuild} sketch={sketch} onAddAt={onAddAt} />
      {addPoint && <mesh position={[addPoint.x, 0.03, addPoint.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}><ringGeometry args={[0.16, 0.24, 40]} /><meshBasicMaterial color="#2f5d46" transparent opacity={0.85} /></mesh>}

      <Architecture project={project} viewMode={viewMode} cutaway={wallsTransparent} selectedId={selectedFeatureId} tool={activeTool} onSelect={onSelectFeature} onPlace={onPlaceFeature} onMoveEndpoint={onMoveEndpoint} onMoveOpening={onMoveOpening} lightingMode={lightingMode} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel} onErase={onErase} onEditLength={onEditLength} />
      {project.objects.map((object) => {
        const product = object.productId ? productById.get(object.productId) ?? null : null
        if (!product && !object.custom) return null
        return (
          <FurnitureObject
            key={object.id}
            object={object}
            viewMode={viewMode}
            selectable={activeTool === 'select'}
            product={product}
            selected={selectedIds.includes(object.id)}
            onSelect={(extend) => onSelectObject(object.id, extend || (selectedIds.length > 1 && selectedIds.includes(object.id)))}
            onDragStart={() => onDragStart(object.id)}
            onDragMove={(x, z, y) => onMoveObject(object.id, x, z, y)}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            cutaway={wallsTransparent}
          />
        )
      })}
    </Canvas>
  )
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

function rectangleWalls(width: number, length: number, height: number): RoomFeature[] {
  const corners: Point[] = [{ x: -width / 2, z: -length / 2 }, { x: width / 2, z: -length / 2 }, { x: width / 2, z: length / 2 }, { x: -width / 2, z: length / 2 }]
  return corners.map((point, index) => wallFromPoints(makeId('wall'), point, corners[(index + 1) % corners.length], height))
}

function PanelHeader({ step, title, intro, onCollapse }: { step: number; title: string; intro: string; onCollapse?: () => void }) {
  return <div className="panel-header">
    <div><span className="step-kicker">Step {step} of 3</span><h1>{title}</h1><p>{intro}</p></div>
    {onCollapse && <button className="icon-button panel-collapse-button" onClick={onCollapse} title="Hide panel" aria-label="Hide panel"><Icon name="panel" /></button>}
  </div>
}

function RoomPanel({ project, floors, activeTool, onTool, onPatch, onQuickRoom, onMeasure, onTemplates, onImport, onNewProject, onNext, onCollapse }: {
  project: ProjectState; floors: ReturnType<typeof getFloorRegions>; activeTool: Tool
  onTool: (tool: Tool) => void; onPatch: (patch: Partial<ProjectState>) => void; onQuickRoom: (width: number, length: number) => void
  onMeasure: () => void; onTemplates: () => void; onImport: () => void; onNewProject: () => void; onNext: () => void; onCollapse?: () => void
}) {
  const [width, setWidth] = useState('5'), [length, setLength] = useState('4')
  const walls = project.features.filter((f) => f.type === 'wall').length
  const doors = project.features.filter((f) => f.type === 'door').length, windows = project.features.filter((f) => f.type === 'window').length
  const area = floors.reduce((sum, region) => sum + region.area, 0)
  const checklist: { tool: Tool; label: string; detail: string; done: boolean; icon: IconName }[] = [
    { tool: 'wall', label: 'Draw walls', detail: floors.length ? `${floors.length} closed ${floors.length === 1 ? 'room' : 'rooms'} · ${area.toFixed(1)} m²` : walls ? 'Keep going until the outline closes' : 'Click corner to corner on the plan', done: floors.length > 0, icon: 'wall' },
    { tool: 'door', label: 'Place a door', detail: doors ? `${doors} added · drag to slide along the wall` : 'Click any wall to add one', done: doors > 0, icon: 'door' },
    { tool: 'window', label: 'Place a window', detail: windows ? `${windows} added · drag to slide along the wall` : 'Click any wall to add one', done: windows > 0, icon: 'window' },
  ]
  const submitQuickRoom = (event: FormEvent) => { event.preventDefault(); onQuickRoom(Number(width), Number(length)) }
  return <>
    <div className="panel-scroll">
      <PanelHeader step={1} title="Build your room" intro="Outline your walls, then add doors and windows. Everything stays editable." onCollapse={onCollapse} />
      {!walls && <section className="panel-card quick-room">
        <button type="button" className="measure-start" onClick={onMeasure}><Icon name="wall" size={20} /><span><strong>Measure your room</strong><small>Walk around and measure wall by wall, with your phone camera or a tape. We build the walls.</small></span><Icon name="arrow" size={14} /></button>
        <div className="panel-card-title"><strong>Start from a rectangle</strong><span>Enter the inside size of your room</span></div>
        <form className="quick-room-form" onSubmit={submitQuickRoom}>
          <label><span>Width</span><span className="unit-input"><input aria-label="Room width in metres" type="number" min="1" max="38" step="0.05" value={width} onChange={(event) => setWidth(event.target.value)} required /><em>m</em></span></label>
          <span className="times" aria-hidden="true">×</span>
          <label><span>Length</span><span className="unit-input"><input aria-label="Room length in metres" type="number" min="1" max="38" step="0.05" value={length} onChange={(event) => setLength(event.target.value)} required /><em>m</em></span></label>
          <button type="submit" className="primary-button">Build this room</button>
        </form>
        <div className="quick-room-alt"><button type="button" className="ghost-button" onClick={onTemplates}><Icon name="home" /> Browse templates</button><button type="button" className="ghost-button" onClick={onImport}><Icon name="upload" /> Import a plan</button></div>
      </section>}
      <section className="panel-section">
        <div className="section-title"><span>{walls ? 'Your progress' : 'Or draw it yourself'}</span></div>
        <ol className="checklist">
          {checklist.map((item) => <li key={item.tool}>
            <button type="button" className={`checklist-item ${item.done ? 'checklist-done' : ''} ${activeTool === item.tool ? 'checklist-active' : ''}`} onClick={() => onTool(item.tool)} disabled={item.tool !== 'wall' && !walls}>
              <span className="checklist-mark">{item.done ? <Icon name="check" size={14} /> : <Icon name={item.icon} size={15} />}</span>
              <span className="checklist-text"><strong>{item.label}</strong><small>{item.detail}</small></span>
              <Icon name="arrow" size={14} />
            </button>
          </li>)}
        </ol>
      </section>
      {project.planImport && <div className="plan-import-result"><strong>Approximate imported plan</strong><span>{project.planImport.provider === 'vertex-ai' ? `AI confidence ${Math.round(project.planImport.confidence * 100)}%` : 'Local axis-aligned fallback'} · {project.planImport.scaleCalibrated ? 'scale calibrated' : 'scale estimated from full width'}</span><small>Review wall lengths, room boundaries and openings before furnishing.</small></div>}
      <section className="panel-section">
        <div className="section-title"><span>Finishes</span></div>
        <div className="swatch-group" role="group" aria-label="Floor finish"><span className="swatch-label">Floor</span><div className="swatches">{Object.entries(floorColors).map(([name, color]) => <button type="button" key={name} className={`swatch ${project.floorMaterial === name ? 'swatch-active' : ''}`} aria-pressed={project.floorMaterial === name} onClick={() => onPatch({ floorMaterial: name })} title={name}><span style={{ background: color }} /><small>{name}</small></button>)}</div></div>
        <div className="swatch-group" role="group" aria-label="Wall finish"><span className="swatch-label">Walls</span><div className="swatches">{Object.entries(wallColors).map(([name, color]) => <button type="button" key={name} className={`swatch ${project.wallMaterial === name ? 'swatch-active' : ''}`} aria-pressed={project.wallMaterial === name} onClick={() => onPatch({ wallMaterial: name })} title={name}><span style={{ background: color }} /><small>{name}</small></button>)}</div></div>
      </section>
      <details className="panel-details">
        <summary>Room settings</summary>
        <label className="field-label">New wall height (m)<NumberInput min="2" max="6" step="0.1" value={project.ceilingHeight} onCommit={(ceilingHeight) => onPatch({ ceilingHeight })} /></label>
        <p className="muted">The build grid is the drawing area. Expand it without resizing your rooms.</p>
        <div className="dimension-grid two-col"><label><span>Grid width · metres</span><NumberInput min={project.width} max="40" step="1" value={project.width} onCommit={(width) => onPatch({ width })} /></label><label><span>Grid length · metres</span><NumberInput min={project.length} max="40" step="1" value={project.length} onCommit={(length) => onPatch({ length })} /></label></div>
      </details>
      <div className="panel-links"><button type="button" className="ghost-button" onClick={onNewProject}><Icon name="plus" /> New project</button>{walls > 0 && <><button type="button" className="ghost-button" onClick={onMeasure}><Icon name="wall" /> Measure a new room</button><button type="button" className="ghost-button" onClick={onImport}><Icon name="upload" /> Import a plan</button></>}</div>
    </div>
    <div className="panel-footer"><button type="button" className="primary-button wide" disabled={!floors.length} onClick={onNext}>{floors.length ? 'Next: furnish your room' : 'Close your walls to continue'} <Icon name="arrow" /></button></div>
  </>
}

function ReviewPanel({ project, total, basketCount, warnings, onSelect, onToggle, onAddAll, onShopping, onExport, onRender, onShare, canRender, onCollapse }: {
  project: ProjectState; total: number | null; basketCount: number; warnings: { id: string; message: string }[]
  onSelect: (id: string) => void; onToggle: (id: string) => void; onAddAll: () => void; onShopping: () => void; onExport: () => void; onRender: () => void; onShare: () => void; canRender: boolean; onCollapse?: () => void
}) {
  const items = project.objects.map((object) => ({ object, product: object.productId ? productById.get(object.productId) ?? null : null, shape: roomItemShape(object) })).filter((item) => item.shape)
  const catalogItems = items.filter((item) => item.product)
  return <>
    <div className="panel-scroll">
      <PanelHeader step={3} title="Review & shop" intro="Choose what you want to buy. Formivo checks availability with each shop before anything is ordered." onCollapse={onCollapse} />
      <div className="summary-cards"><div><strong>{items.length}</strong><span>In your room</span></div><div><strong>{basketCount}</strong><span>In basket</span></div><div><strong>{formatPrice(total)}</strong><span>Estimate</span></div></div>
      <section className="panel-section">
        <div className="section-title"><span>Items in your room</span>{catalogItems.some((item) => !item.object.inBasket) && <button type="button" className="text-button" onClick={onAddAll} aria-label="Add all products to basket">Add all</button>}</div>
        {items.length === 0 ? <p className="empty-note">Nothing placed yet. Head back to Furnish to add pieces.</p> : <ul className="review-list">
          {items.map(({ object, product, shape }) => {
            const variant = product?.variants?.find((candidate) => candidate.id === object.variantId)
            return <li key={object.id} className="review-item">
              <button type="button" className="review-item-main" onClick={() => onSelect(object.id)} title={`Select ${shape!.name}`}>
                {product ? <ProductThumb product={{ ...product, thumbnailPath: variant?.thumbnailPath || product.thumbnailPath }} compact /> : <span className="custom-swatch" style={{ background: shape!.tone }} />}
                <span><strong>{shape!.name}</strong><small>{product ? `${variant ? `${variant.name} · ` : ''}${formatPrice(product.price)}` : 'Your own item · not for sale'}</small></span>
              </button>
              {product ? <button type="button" className={`basket-toggle ${object.inBasket ? 'basket-toggle-on' : ''}`} aria-pressed={Boolean(object.inBasket)} aria-label={object.inBasket ? `Remove ${shape!.name} from basket` : `Add ${shape!.name} to basket`} onClick={() => onToggle(object.id)}>{object.inBasket ? <><Icon name="check" size={14} /> In basket</> : <><Icon name="plus" size={14} /> Add</>}</button> : <span className="review-tag">Owned</span>}
            </li>
          })}
        </ul>}
      </section>
      <section className="panel-section">
        <div className="section-title"><span>Space check</span><span className={`check-pill ${warnings.length ? 'check-pill-warning' : ''}`}>{warnings.length ? `${warnings.length} to review` : 'All clear'}</span></div>
        {warnings.length ? warnings.map((warning, i) => <div className="health-row warning" key={i}><span className="health-dot" />{warning.message}</div>) : <div className="health-row"><span className="health-dot" />No boundary, overlap or door-clearance warnings.</div>}
        <p className="muted">Basic footprint checks. Verify circulation and delivery access before purchase.</p>
      </section>
      <section className="panel-section">
        <div className="section-title"><span>Share & visualise</span></div>
        <div className="action-tiles">
          <button type="button" onClick={onRender} disabled={!canRender}><Icon name="image" size={18} /><span><strong>Create a render</strong><small>Photo-style view of your room</small></span></button>
          <button type="button" onClick={onShare}><Icon name="share" size={18} /><span><strong>Copy share link</strong><small>Anyone with it can open a copy</small></span></button>
          <button type="button" onClick={onExport}><Icon name="download" size={18} /><span><strong>Download CSV</strong><small>Shopping list for your records</small></span></button>
        </div>
      </section>
    </div>
    <div className="panel-footer"><button type="button" className="primary-button wide" onClick={onShopping}><Icon name="shopping" /> Review basket{basketCount ? ` (${basketCount})` : ''} <Icon name="arrow" /></button></div>
  </>
}

function WallHeight({ object, onPatch }: { object: RoomObject; onPatch: (patch: Partial<RoomObject>) => void }) {
  return <section className="inspector-section">
    <div className="section-label-row"><span>On the wall</span><span className="muted">cm</span></div>
    <label className="field-label"><span>Height above floor (cm)</span><NumberInput aria-label="Height above floor in centimetres" min="0" max="600" step="5" value={Math.round((object.elevation ?? 0) * 100)} onCommit={(cm) => onPatch({ elevation: cm / 100 })} /></label>
    <p className="muted">Measured to the bottom edge. Drag the item to slide it along its wall.</p>
  </section>
}

function ObjectProperties({ object, product, actions, similar, onPatch, onClose }: {
  onClose: () => void
  object: RoomObject
  product: Product
  actions: ReactNode
  similar: ReactNode
  onPatch: (patch: Partial<RoomObject>) => void
}) {
  const variant = product.variants?.find((candidate) => candidate.id === object.variantId)
  return (
    <>
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">{product.category}</span>
          <h2>{product.name}</h2>
        </div>
        <button className="icon-button" title="Close selection" aria-label="Close selection" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="selected-product-card"><ProductThumb product={{ ...product, thumbnailPath: variant?.thumbnailPath || product.thumbnailPath }} compact /><div><strong>{formatPrice(product.price)}</strong><span>{product.brand} · {product.retailer}</span><small>{product.width} × {product.depth} × {product.height} cm</small></div></div>
      {actions}
      {product.verification && <p className="muted">Photo-based reconstruction · visual review pending. Fabric and fine details are inferred, not manufacturer-verified.</p>}
      {product.variants?.length ? <section className="inspector-section">
        <div className="section-label-row"><span>Colour</span></div>
        <label className="field-label"><span className="visually-hidden">Finish</span><select aria-label="Product variant" value={object.variantId || product.variants[0].id} onChange={(event) => onPatch({ variantId: event.target.value })}>{product.variants.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sourceVariantName ? ` · ${item.sourceVariantName}` : ''}</option>)}</select></label>
      </section> : null}
      {similar}
      {isWallMounted(object) ? <WallHeight object={object} onPatch={onPatch} /> : <section className="inspector-section">
        <div className="section-label-row"><span>Exact position</span><span className="muted">metres · degrees</span></div>
        <div className="dimension-grid placement-grid">
          <label><span>X</span><NumberInput step="0.05" value={object.x.toFixed(2)} onCommit={(x) => onPatch({ x })} /></label>
          <label><span>Z</span><NumberInput step="0.05" value={object.z.toFixed(2)} onCommit={(z) => onPatch({ z })} /></label>
          <label><span>Rotation</span><NumberInput step="15" value={Math.round((object.rotation * 180) / Math.PI)} onCommit={(rotation) => onPatch({ rotation: rotation * Math.PI / 180 })} /></label>
        </div>
      </section>}
      <section className="inspector-section">
        <div className="section-label-row"><span>Size</span><span className="verified-label">{product.status.includes('Verified') ? 'Verified' : 'Check status'}</span></div>
        <div className="spec-grid"><div><strong>{product.width}</strong><span>Length cm</span></div><div><strong>{product.depth}</strong><span>{product.cornerDepth ? 'Corner depth cm' : 'Depth cm'}</span></div><div><strong>{product.height}</strong><span>Height cm</span></div></div>
        <p className="muted">{product.status}</p>
      </section>
    </>
  )
}

function CustomObjectProperties({ object, actions, onPatch, onClose }: { object: RoomObject & { custom: CustomRoomItem }; actions: ReactNode; onPatch: (patch: Partial<RoomObject>) => void; onClose: () => void }) {
  const [name, setName] = useState(object.custom.name)
  useEffect(() => setName(object.custom.name), [object.custom.name])
  const patch = (value: Partial<CustomRoomItem>) => onPatch({ custom: { ...object.custom, ...value } })
  return <>
    <div className="inspector-heading"><div><span className="eyebrow">Your own item · not for sale</span><h2>{object.custom.name}</h2></div><button className="icon-button" title="Close selection" aria-label="Close selection" onClick={onClose}><Icon name="close" /></button></div>
    {actions}
    <section className="inspector-section"><div className="section-label-row"><span>Measured size</span><span className="muted">cm</span></div><div className="dimension-grid"><label><span>Width</span><NumberInput min="1" max="2000" step="1" value={object.custom.width} onCommit={(width) => patch({ width })} /></label><label><span>Depth</span><NumberInput min="1" max="2000" step="1" value={object.custom.depth} onCommit={(depth) => patch({ depth })} /></label><label><span>Height</span><NumberInput min="1" max="600" step="1" value={object.custom.height} onCommit={(height) => patch({ height })} /></label></div></section>
    <section className="inspector-section"><div className="section-label-row"><span>Appearance</span></div><label className="field-label">Name<input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => { if (name.trim()) patch({ name: name.trim() }); else setName(object.custom.name) }} maxLength={80} /></label><div className="form-grid"><label className="field-label">Colour<input type="color" value={object.custom.color} onChange={(event) => patch({ color: event.target.value })} /></label>{object.custom.kind !== 'wall' && <label className="field-label">Type<select value={object.custom.kind} onChange={(event) => patch({ kind: event.target.value as CustomRoomItem['kind'] })}><option value="furniture">Furniture</option><option value="rug">Rug</option></select></label>}</div></section>
    {object.custom.kind === 'wall' ? <WallHeight object={object} onPatch={onPatch} /> : <section className="inspector-section"><div className="section-label-row"><span>Exact position</span><span className="muted">metres · degrees</span></div><div className="dimension-grid placement-grid"><label><span>X</span><NumberInput step="0.05" value={object.x.toFixed(2)} onCommit={(x) => onPatch({ x })} /></label><label><span>Z</span><NumberInput step="0.05" value={object.z.toFixed(2)} onCommit={(z) => onPatch({ z })} /></label><label><span>Rotation</span><NumberInput step="15" value={Math.round(object.rotation * 180 / Math.PI)} onCommit={(rotation) => onPatch({ rotation: rotation * Math.PI / 180 })} /></label></div></section>}
    <p className="muted">This item stays in your room plan but is never added to the shopping basket.</p>
  </>
}

function FeatureProperties({ project, feature, onPatch, onDelete, onClose }: { project: ProjectState; feature: RoomFeature; onPatch: (patch: Partial<RoomFeature>) => void; onDelete: () => void; onClose: () => void }) {
  const title = feature.type === 'wall' ? 'Wall' : feature.type === 'door' ? 'Door opening' : 'Window opening'
  return (
    <>
      <div className="inspector-heading"><div><span className="eyebrow">Architecture</span><h2>{title}</h2></div><button className="icon-button" title="Close selection" aria-label="Close selection" onClick={onClose}><Icon name="close" /></button></div>
      <p className="inspector-hint">{feature.type === 'wall' ? 'Drag the round handles at either end to reshape. Connected walls and floors follow.' : 'Drag it along its wall to reposition. It follows the wall when you reshape the room.'}</p>
      {feature.type !== 'wall' && <OpeningOptions feature={feature} onPatch={onPatch} />}
      <section className="inspector-section"><div className="section-label-row"><span>{feature.type === 'wall' ? 'Size' : 'Exact size'}</span><span className="muted">metres</span></div><div className="dimension-grid"><label><span>Width</span><NumberInput min="0.3" max="20" step="0.05" value={feature.width} onCommit={(width) => onPatch({ width })} /></label><label><span>Height</span><NumberInput min="0.3" max="6" step="0.05" value={feature.height} onCommit={(height) => onPatch({ height })} /></label>{feature.type === 'wall' && <label><span>Thickness</span><NumberInput min="0.02" max="2" step="0.01" value={wallThickness(feature).toFixed(3)} onCommit={(thickness) => onPatch({ thickness })} /></label>}{feature.type === 'window' && <label><span>Sill</span><NumberInput min="0" max="6" step="0.05" value={feature.sillHeight || 0} onCommit={(sillHeight) => onPatch({ sillHeight })} /></label>}</div></section>
      <section className="inspector-section"><div className="section-label-row"><span>Position</span><span className="muted">metres · degrees</span></div>{feature.type === 'wall' ? <div className="dimension-grid placement-grid"><label><span>X</span><NumberInput step="0.05" value={feature.x.toFixed(2)} onCommit={(x) => onPatch({ x })} /></label><label><span>Z</span><NumberInput step="0.05" value={feature.z.toFixed(2)} onCommit={(z) => onPatch({ z })} /></label><label><span>Rotation</span><NumberInput step="15" value={Math.round((feature.rotation * 180) / Math.PI)} onCommit={(rotation) => onPatch({ rotation: rotation * Math.PI / 180 })} /></label></div> : <><label className="field-label">Attached wall<select value={feature.wallId} onChange={(event) => onPatch({ wallId: event.target.value, wallOffset: 0 })}>{project.features.filter((f) => f.type === 'wall' && f.width >= 0.5).map((wall, i) => <option key={wall.id} value={wall.id}>Wall {i + 1} · {wall.width.toFixed(2)} m</option>)}</select></label><label className="field-label">Offset from wall centre (m)<NumberInput step="0.1" value={feature.wallOffset || 0} onCommit={(wallOffset) => onPatch({ wallOffset })} /></label></>}</section>
      {feature.type === 'wall' && <p className="muted">Removing this wall also removes its doors and windows.</p>}
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
  items: { id: string; product: Product; variantName?: string; quantity: number; subtotal: number | null }[]
  total: number | null
  onClose: () => void
  onExport: () => void
  onRequest: () => void
}) {
  const retailers = new Set(items.map((item) => item.product.retailer)).size
  return (
    <>
      <button className="drawer-backdrop" aria-label="Close shopping list" onClick={onClose} />
      <aside className="shopping-drawer" role="dialog" aria-modal="true" aria-label="Shopping list">
        <div className="drawer-header"><div><span className="eyebrow">Basket for manual review</span><h2>Shopping list</h2></div><button className="icon-button" onClick={onClose} title="Close shopping list"><Icon name="close" /></button></div>
        <div className="drawer-intro"><span className="drawer-check">✓</span><p>{items.length} products from {retailers} retailers<br /><small>Grouped by product and SKU</small></p></div>
        <div className="shopping-items">
          {items.map(({ id, product, variantName, quantity, subtotal }) => (
            <div className="shopping-item" key={id}><ProductThumb product={product} compact /><div className="shopping-item-info"><strong>{product.name}{variantName ? ` · ${variantName}` : ''}</strong><span>{product.retailer} · {product.sku}</span><small>{product.width} × {product.depth} × {product.height} cm · {formatPrice(product.price)} each</small><small>{product.status}</small></div><div className="shopping-item-price"><span>×{quantity}</span><strong>{formatPrice(subtotal)}</strong></div></div>
          ))}
          {items.length === 0 ? <div className="empty-search">No products in the basket yet. Add any room item when you are ready to consider buying it.</div> : <section className="retailer-summary"><h3>By retailer</h3>{[...new Set(items.map((item) => item.product.retailer))].map((name) => <div key={name}><span>{name}</span><strong>{formatPrice(items.filter((item) => item.product.retailer === name).some((item) => item.subtotal === null) ? null : items.filter((item) => item.product.retailer === name).reduce((sum, item) => sum + (item.subtotal ?? 0), 0))}</strong></div>)}</section>}
        </div>
        <div className="drawer-total"><div><span>Estimated total</span><small>Prices and stock will be checked with the retailers.</small></div><strong>{formatPrice(total)}</strong></div>
        <div className="drawer-actions"><button className="secondary-button" onClick={onExport}><Icon name="download" /> Export CSV</button><button className="primary-button" onClick={onRequest} disabled={!items.length}><Icon name="arrow" /> Request purchase</button></div>
      </aside>
    </>
  )
}

type RoomTemplate = 'empty' | 'living-room' | 'bedroom' | 'studio'

function roomTemplateProject(template: RoomTemplate, name: string) {
  const project = emptyProject(name)
  if (template === 'empty') return project
  const room = template === 'living-room' ? { type: 'Living room', width: 5.5, length: 4.5, objects: [['sofa-haven', 0, -1], ['table-arc', 0, 0.2], ['rug-loom', 0, 0.1], ['lamp-halo', -2, 1.3]] as [string, number, number][] }
    : template === 'bedroom' ? { type: 'Bedroom', width: 4.6, length: 4.8, objects: [['bed-cloud', 0, -0.1], ['nightstand-form', -1.25, -0.7], ['nightstand-form', 1.25, -0.7]] as [string, number, number][] }
      : { type: 'Studio', width: 7, length: 5.5, objects: [['sofa-haven', -1, -1.3], ['table-arc', -0.7, 0.2], ['rug-loom', -0.7, 0.2], ['table-form', 1.7, 1.2]] as [string, number, number][] }
  project.roomType = room.type
  project.features = rectangleWalls(room.width, room.length, project.ceilingHeight)
  project.objects = room.objects.map(([productId, x, z]) => {
    const variantId = productById.get(productId)?.variants?.[0]?.id
    return { id: makeId('object'), productId, ...(variantId ? { variantId } : {}), x, z, rotation: 0, inBasket: false }
  })
  return project
}

function NewProjectModal({ onClose, onCreate, initialTemplate = 'empty' }: { onClose: () => void; onCreate: (project: ProjectState) => void; initialTemplate?: RoomTemplate }) {
  const [name, setName] = useState('My space')
  const [template, setTemplate] = useState<RoomTemplate>(initialTemplate)
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate(roomTemplateProject(template, name.trim() || 'My space')) }
  const templates: { id: RoomTemplate; name: string; detail: string; icon: IconName }[] = [{ id: 'empty', name: 'Empty', detail: 'Draw your own room', icon: 'wall' }, { id: 'living-room', name: 'Living room', detail: 'Sofa, table, rug, lamp', icon: 'sofa' }, { id: 'bedroom', name: 'Bedroom', detail: 'Bed and bedside tables', icon: 'home' }, { id: 'studio', name: 'Studio', detail: 'Living and dining zones', icon: 'grid' }]
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close new project dialog" /><form className="modal-card" role="dialog" aria-modal="true" aria-label="Project dialog" onSubmit={submit}>
    <div className="modal-header"><div><span className="eyebrow">New project</span><h2>Create your space</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    <label className="field-label">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="template-options" role="group" aria-label="Room template">{templates.map((item) => <button type="button" key={item.id} className={template === item.id ? 'template-option template-option-active' : 'template-option'} aria-pressed={template === item.id} onClick={() => setTemplate(item.id)}><Icon name={item.icon} size={20} /><strong>{item.name}</strong><span>{item.detail}</span></button>)}</div>
    <p className="form-note">Templates create editable walls and sample furniture. Sample products start outside the basket, so you can experiment freely. Your current layout is replaced; Undo brings it back.</p>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">{template === 'empty' ? 'Create space' : 'Create room'} <Icon name="arrow" /></button></div>
  </form></div>
}

function PurchaseRequestModal({ total, onClose, onSubmit }: { total: number | null; onClose: () => void; onSubmit: (customer: { name: string; phone: string; city: string; notes: string }) => Promise<void> }) {
  const [submitted, setSubmitted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    try {
      await onSubmit({ name: String(form.get('name') || ''), phone: String(form.get('phone') || ''), city: String(form.get('city') || ''), notes: String(form.get('notes') || '') })
      setSubmitted(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request could not be sent.') }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close purchase request" />{submitted ? <div className="modal-card success-card" role="dialog" aria-modal="true" aria-label="Purchase request submitted"><div className="success-icon">✓</div><span className="eyebrow">Request submitted</span><h2>Your request is with Formivo.</h2><p>We’ll check availability with each shop. Track progress in your profile. This request is not an order, and no payment has been taken.</p><button className="primary-button" autoFocus onClick={onClose}>Back to room</button></div> : <form className="modal-card" role="dialog" aria-modal="true" aria-label="Purchase request" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">Estimated total {formatPrice(total)}</span><h2>Request purchase</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid"><label className="field-label">Full name<input name="name" required placeholder="Your name" /></label><label className="field-label">Account email<input type="email" value={auth?.currentUser?.email || ''} disabled /></label><label className="field-label">Phone<input name="phone" type="tel" placeholder="+30 69..." /></label><label className="field-label">Delivery city<input name="city" required placeholder="Athens" /></label></div><label className="field-label">Notes<textarea name="notes" rows={3} placeholder="Anything we should know about delivery or installation?" /></label><p className="form-note">Your basket and delivery details go to Formivo for manual availability checks. This does not place an order or take payment.</p>{error && <p className="form-note" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send purchase request'} <Icon name="arrow" /></button></div></form>}</div>
  )
}

function PlanImportModal({ onClose, onImport }: { onClose: () => void; onImport: (project: ProjectState) => void }) {
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null)
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('Imported plan')
  const [realWidth, setRealWidth] = useState('')
  const [selected, setSelected] = useState<{ kind: 'walls' | 'openings'; index: number } | null>(null)
  const [draw, setDraw] = useState<'select' | 'calibrate' | 'wall' | 'door' | 'window'>('select')
  const [start, setStart] = useState<PixelPoint | null>(null)
  const [calibrationPoints, setCalibrationPoints] = useState<PixelPoint[]>([])
  const [allowAi, setAllowAi] = useState(false)
  const [elevationFile, setElevationFile] = useState<File | null>(null)
  const [elevationName, setElevationName] = useState('')
  const [ceilingHeight, setCeilingHeight] = useState(2.8)
  const [ceilingHeightEdited, setCeilingHeightEdited] = useState(false)
  const sourceFile = useRef<File | null>(null)
  const request = useRef(0)
  const draft = useMemo(() => {
    if (!analysis || !realWidth || calibrationPoints.length === 1) return { project: null, error: '' }
    const calibration: PlanCalibration | undefined = calibrationPoints.length === 2 ? { a: calibrationPoints[0], b: calibrationPoints[1] } : undefined
    try { return { project: createProjectFromPlan(analysis, Number(realWidth), name, calibration, ceilingHeight), error: '' } }
    catch (reason) { return { project: null, error: reason instanceof Error ? reason.message : 'Check the drawing.' } }
  }, [analysis, realWidth, name, calibrationPoints, ceilingHeight])
  const update = (next: PlanAnalysis) => { setAnalysis(next) }
  const selectedSegment = selected && analysis ? analysis[selected.kind][selected.index] : null
  const selectedOpening = selected?.kind === 'openings' && analysis ? analysis.openings[selected.index] : null
  const patchSegment = (patch: Partial<PixelOpening>) => {
    if (!selected || !analysis || !selectedSegment) return
    const next = { ...selectedSegment, ...patch, a: { ...(patch.a || selectedSegment.a) }, b: { ...(patch.b || selectedSegment.b) } }
    if (analysis.provider === 'vertex-ai') next.horizontal = Math.abs(next.b.x - next.a.x) >= Math.abs(next.b.y - next.a.y)
    else if (next.horizontal) next.b.y = next.a.y
    else next.b.x = next.a.x
    update({ ...analysis, [selected.kind]: analysis[selected.kind].map((item, i) => i === selected.index ? next : item) })
  }
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const choose = async (file: File | undefined, nextElevation: File | null = elevationFile, useAi = allowAi) => {
    if (!file) return
    sourceFile.current = file
    const version = ++request.current
    setFileName(file.name)
    setName(file.name.replace(/\.[^.]+$/, '') || 'Imported plan')
    setError(''); setSelected(null); setStart(null); setCalibrationPoints([]); setRealWidth(''); setCeilingHeight(2.8); setCeilingHeightEdited(false)
    setAnalysis(null)
    setLoading(true)
    try {
      const result = await analyzePlanFile(file, useAi ? requestPlanDetection : undefined, useAi ? nextElevation || undefined : undefined)
      if (version === request.current) {
        setAnalysis(result)
        if (result.ceilingHeight !== undefined && (result.ceilingHeightConfidence ?? 0) >= 0.65) setCeilingHeight(result.ceilingHeight)
      }
    } catch (reason) { if (version === request.current) setError(reason instanceof Error ? reason.message : 'The drawing could not be analyzed.') }
    finally { if (version === request.current) setLoading(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.project) return
    onImport(draft.project)
  }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close import dialog" /><form className="modal-card plan-import-card" role="dialog" aria-modal="true" aria-label="Import architectural drawing" onSubmit={submit}>
    <div className="modal-header"><div><span className="eyebrow">AI-assisted · approximate geometry</span><h2>Import a floor plan</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    <p className="catalog-intro">Upload a floor plan, screenshot, or simple sketch. Review and calibrate the detected walls before building the 3D room. Add an elevation to help estimate ceiling, door, and window heights. Room photos and video are not supported in this release.</p>
    <label className="plan-ai-consent"><input type="checkbox" checked={allowAi} onChange={(event) => { const useAi = event.target.checked; setAllowAi(useAi); if (sourceFile.current) void choose(sourceFile.current, elevationFile, useAi) }} /><span>Send the plan and optional elevation to Google Vertex AI for detection. If unchecked, use the on-device plan detector; it cannot read elevation heights. Images are processed for this request and are not stored by the detection service.</span></label>
    <label className="plan-import-file"><Icon name="upload" /><span>{fileName || 'Choose PNG, JPG, WebP, SVG, or PDF floor plan'}</span><input aria-label="Floor plan drawing" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf" onChange={(event) => choose(event.currentTarget.files?.[0])} /></label>
    {allowAi && <label className="plan-import-file"><Icon name="upload" /><span>{elevationName || 'Optional elevation drawing · PDF, PNG, JPG, or WebP'}</span><input aria-label="Elevation drawing" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0] || null; setElevationFile(file); setElevationName(file?.name || ''); if (sourceFile.current) void choose(sourceFile.current, file, allowAi) }} /></label>}
    {loading && <div className="plan-import-status" role="status">{allowAi ? 'Sending the plan for AI detection…' : 'Analyzing locally…'}</div>}
    {error && <div className="plan-import-error" role="alert">{error}</div>}
    {analysis && <>
      <div className="plan-review-tools">{(['select', 'calibrate', 'wall', 'door', 'window'] as const).map((tool) => <button type="button" key={tool} aria-pressed={draw === tool} onClick={() => { setDraw(tool); setStart(null) }}>{tool === 'select' ? 'Select / correct' : tool === 'calibrate' ? 'Set scale' : `Add ${tool}`}</button>)}</div>
      <p className="muted">Green: walls · blue/purple: suggested windows/doors · orange: gaps left open. {draw === 'select' ? 'Select a line to edit or remove it.' : draw === 'calibrate' ? calibrationPoints.length === 0 ? 'Tap the first point of a known dimension.' : calibrationPoints.length === 1 ? 'Tap the second point on the same known dimension.' : 'Scale reference set; tap two points to choose a different line.' : start ? 'Click the second endpoint.' : 'Click two endpoints on the source to add a segment.'}</p>
      <svg className="plan-import-preview" viewBox={`0 0 ${analysis.sourceWidth} ${analysis.sourceHeight}`} role="img" aria-label="Detected walls and openings over the source drawing" onClick={(event) => {
        if (draw === 'select') return
        const svg = event.currentTarget, matrix = svg.getScreenCTM()
        if (!matrix) return
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
        const nearby = analysis.walls.flatMap((wall) => [wall.a, wall.b]).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
        const end = nearby && Math.hypot(nearby.x - p.x, nearby.y - p.y) < 10 ? { ...nearby } : { x: Math.round(p.x), y: Math.round(p.y) }
        if (draw === 'calibrate') {
          if (calibrationPoints.length !== 1) setCalibrationPoints([end])
          else if (Math.hypot(end.x - calibrationPoints[0].x, end.y - calibrationPoints[0].y) >= 8) setCalibrationPoints([calibrationPoints[0], end])
          return
        }
        if (!start) { setStart(end); return }
        const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
        const a = { ...start }, b = analysis.provider === 'vertex-ai' ? { ...end } : horizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
        if (Math.hypot(a.x - b.x, a.y - b.y) < 8) return
        const reversed = analysis.provider === 'vertex-ai' ? false : horizontal ? a.x > b.x : a.y > b.y
        const wall: PixelWall = { a: reversed ? b : a, b: reversed ? a : b, horizontal, thickness: 8 }
        update(draw === 'wall' ? { ...analysis, walls: [...analysis.walls, wall] } : { ...analysis, openings: [...analysis.openings, { ...wall, type: draw }] })
        setStart(null)
      }}>
        <image href={analysis.previewUrl} width={analysis.sourceWidth} height={analysis.sourceHeight} />
        {[analysis.bounds.minX, analysis.bounds.maxX].map((x) => <line key={x} x1={x} x2={x} y1={0} y2={analysis.sourceHeight} stroke="#a3483d" strokeDasharray="8 6" strokeWidth={1} pointerEvents="none" />)}
        <line x1={analysis.bounds.minX} x2={analysis.bounds.maxX} y1={(analysis.bounds.minY + analysis.bounds.maxY) / 2} y2={(analysis.bounds.minY + analysis.bounds.maxY) / 2} stroke="#bd8052" strokeDasharray="5 5" strokeWidth={2} pointerEvents="none" />
        {analysis.roomLabels?.map((label, index) => <text key={`label-${index}`} x={label.x} y={label.y} fill="#273f30" fontSize={20} fontWeight={600} textAnchor="middle" pointerEvents="none">{label.name}</text>)}
        {calibrationPoints.length === 2 && <line x1={calibrationPoints[0].x} y1={calibrationPoints[0].y} x2={calibrationPoints[1].x} y2={calibrationPoints[1].y} stroke="#e0a13d" strokeWidth={Math.max(4, analysis.sourceWidth / 180)} pointerEvents="none" />}
        {calibrationPoints.map((point, index) => <circle key={`calibration-${index}`} cx={point.x} cy={point.y} r={Math.max(8, analysis.sourceWidth / 120)} fill="#e0a13d" pointerEvents="none"><title>{`Scale point ${index + 1}`}</title></circle>)}
        {(['walls', 'openings'] as const).flatMap((kind) => analysis[kind].map((item, index) => {
          const opening = item as PixelOpening
          const type = kind === 'walls' ? 'wall' : opening.type === 'unconfirmed' ? opening.suggestedType || 'unconfirmed' : opening.type
          const color = type === 'wall' ? '#168448' : type === 'window' ? '#087cd4' : type === 'door' ? '#a537c0' : type === 'ignore' ? '#888888' : '#e77c12'
          return <line key={`${kind}-${index}`} x1={item.a.x} y1={item.a.y} x2={item.b.x} y2={item.b.y} stroke={color} strokeWidth={Math.max(3, item.thickness) + (selected?.kind === kind && selected.index === index ? 3 : 0)} strokeOpacity={0.55} strokeDasharray={type === 'unconfirmed' || type === 'ignore' || (item.confidence !== undefined && item.confidence < 0.55) ? '6 4' : undefined} onClick={(event) => { if (draw === 'select') { event.stopPropagation(); setSelected({ kind, index }) } }}><title>{`${type} ${index + 1}`}</title></line>
        }))}
        {start && <circle cx={start.x} cy={start.y} r={5} fill="#e77c12" />}
      </svg>
      <div className="plan-detection-result" role="status"><strong>{analysis.provider === 'vertex-ai' ? 'Vertex AI detection' : 'Local fallback detection'}</strong><span>{analysis.provider === 'vertex-ai' ? `${Math.round((analysis.confidence || 0) * 100)}% overall confidence · geometry remains approximate` : 'Limited to clear axis-aligned filled walls'}</span></div>
      {analysis.knownDimensions?.length ? <div className="plan-known-dimensions"><span>Detected dimensions</span>{analysis.knownDimensions.map((dimension, index) => <button type="button" key={index} aria-label={`Use scale ${dimension.label}, ${dimension.meters} metres`} onClick={() => { setCalibrationPoints([dimension.a, dimension.b]); setRealWidth(String(dimension.meters)); setDraw('calibrate') }}>Use {dimension.label}: {dimension.meters.toFixed(2)} m · {Math.round(dimension.confidence * 100)}%</button>)}</div> : null}
      <div className="plan-import-stats"><span><strong>{analysis.walls.length}</strong> wall segments</span><span><strong>{analysis.openings.filter((o) => o.type === 'door' || o.type === 'window' || (o.type === 'unconfirmed' && o.suggestedType)).length}</strong> suggested openings</span><span><strong>{analysis.roomLabels?.length || 0}</strong> room labels</span></div>
      <label className="field-label">Review detected segment<select aria-label="Review detected segment" value={selected ? `${selected.kind}:${selected.index}` : ''} onChange={(event) => { const [kind, index] = event.target.value.split(':'); setSelected(kind ? { kind: kind as 'walls' | 'openings', index: Number(index) } : null) }}><option value="">Select a segment</option>{(['walls', 'openings'] as const).flatMap((kind) => analysis[kind].map((item, i) => <option key={`${kind}:${i}`} value={`${kind}:${i}`}>{kind === 'walls' ? 'Wall' : (item as PixelOpening).type} {i + 1}</option>))}</select></label>
      {selected && selectedSegment && <div className="plan-segment-editor">
        {selected.kind === 'openings' && <label className="field-label">Opening type<select aria-label="Opening type" value={(selectedSegment as PixelOpening).type} onChange={(event) => patchSegment({ type: event.target.value as PixelOpening['type'] })}><option value="unconfirmed">Unconfirmed{(selectedSegment as PixelOpening).suggestedType ? ` · suggested ${(selectedSegment as PixelOpening).suggestedType}` : ''}</option><option value="door">Door</option><option value="window">Window</option><option value="ignore">Ignore gap / open passage</option></select></label>}
        {selectedOpening && (selectedOpening.type === 'door' || selectedOpening.type === 'window') && <>
          <label className="field-label">Opening height (m)<NumberInput min="0.3" max={ceilingHeight} step="0.05" value={selectedOpening.height ?? (selectedOpening.type === 'door' ? 2.1 : 1.35)} onCommit={(height) => patchSegment({ height, verticalConfidence: 1 })} /></label>
          {selectedOpening.type === 'window' && <label className="field-label">Sill height (m)<NumberInput min="0" max={Math.max(0.3, ceilingHeight - 0.3)} step="0.05" value={selectedOpening.sillHeight ?? 0.85} onCommit={(sillHeight) => patchSegment({ sillHeight, verticalConfidence: 1 })} /></label>}
          <small className="muted">{selectedOpening.verticalConfidence !== undefined && selectedOpening.verticalConfidence >= 0.65 ? `High-confidence or reviewed vertical values · ${Math.round(selectedOpening.verticalConfidence * 100)}%; applied to this import.` : selectedOpening.verticalConfidence !== undefined ? `Low-confidence elevation estimate · ${Math.round(selectedOpening.verticalConfidence * 100)}%; standard size is used until corrected.` : 'Standard size is used until you enter a measured value.'}</small>
        </>}
        {(['a', 'b'] as const).map((end) => <div className="dimension-grid" key={end}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{end.toUpperCase()} {axis} (px)<NumberInput disabled={analysis.provider !== 'vertex-ai' && end === 'b' && axis === (selectedSegment.horizontal ? 'y' : 'x')} min={0} max={axis === 'x' ? analysis.sourceWidth : analysis.sourceHeight} step={1} value={selectedSegment[end][axis]} onCommit={(value) => patchSegment({ [end]: { ...selectedSegment[end], [axis]: value } })} /></label>)}</div>)}
        <button type="button" className="danger-button" onClick={() => { update({ ...analysis, [selected.kind]: analysis[selected.kind].filter((_, i) => i !== selected.index) }); setSelected(null) }}>Remove segment</button>
      </div>}
      <div className="form-grid"><label className="field-label">Project name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Known dimension (m)<input required type="number" min="0.25" max="38" step="any" placeholder="Enter the measured distance" value={realWidth} onChange={(event) => setRealWidth(event.target.value)} /><small className="muted">{calibrationPoints.length === 2 ? `Distance between selected points: ${Math.hypot(calibrationPoints[1].x - calibrationPoints[0].x, calibrationPoints[1].y - calibrationPoints[0].y).toFixed(0)} px` : 'By default this is the full detected width between dashed guides.'}</small></label><label className="field-label">Ceiling height (m)<NumberInput min="2" max="6" step="0.05" value={ceilingHeight} onCommit={(value) => { setCeilingHeight(value); setCeilingHeightEdited(true) }} /><small className="muted">{ceilingHeightEdited ? 'Manual height will be used for this import.' : analysis.ceilingHeight !== undefined ? (analysis.ceilingHeightConfidence || 0) >= 0.65 ? `Elevation estimate ${analysis.ceilingHeight.toFixed(2)} m · ${Math.round((analysis.ceilingHeightConfidence || 0) * 100)}% confidence; applied. Review or adjust.` : `Low-confidence elevation estimate ${analysis.ceilingHeight.toFixed(2)} m; using standard 2.8 m until corrected.` : 'No vertical measurement extracted; using standard 2.8 m unless you enter a known height.'}</small></label></div>
      <div className="plan-import-notes">{analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      {draft.error && <p role="alert" className="plan-import-error">{draft.error}</p>}
      <p className="plan-review-confirm">AI geometry and dimensions are approximate even after scale calibration. This creates editable walls and openings, adds no furniture, and replaces the current layout. Undo restores the previous layout.</p>
    </>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!draft.project || loading}>Create editable room</button></div>
  </form></div>
}

function WallLengthDialog({ wall, onClose, onSet }: { wall?: RoomFeature; onClose: () => void; onSet: (length: number) => void }) {
  const [value, setValue] = useState(wall ? wall.width.toFixed(2) : '')
  if (!wall) return null
  const submit = (event: FormEvent) => { event.preventDefault(); const length = Number(value.replace(',', '.')); if (length >= 0.25 && length <= 40) onSet(Math.round(length * 100) / 100) }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close wall length dialog" /><form className="modal-card length-card" role="dialog" aria-modal="true" aria-label="Wall length" onSubmit={submit}>
    <div className="modal-header"><div><span className="eyebrow">Now {wall.width.toFixed(2)} m</span><h2>Wall length</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    <label className="field-label"><span>Length</span><span className="unit-input"><input aria-label="Wall length in metres" inputMode="decimal" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} /><em>m</em></span></label>
    <p className="form-note">The far corner moves along the wall, and the next wall moves with it so the room stays closed.</p>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Set length</button></div>
  </form></div>
}

function ExistingItemModal({ onClose, onCreate }: { onClose: () => void; onCreate: (item: CustomRoomItem) => void }) {
  const [name, setName] = useState('Existing furniture')
  const [width, setWidth] = useState('100'), [depth, setDepth] = useState('100'), [height, setHeight] = useState('100')
  const [color, setColor] = useState('#bca58a'), [kind, setKind] = useState<CustomRoomItem['kind']>('furniture')
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate({ name: name.trim() || 'Existing furniture', width: clamp(Number(width), 1, 2000), depth: clamp(Number(depth), 1, 2000), height: clamp(Number(height), 1, 600), color, kind }) }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close existing furniture dialog" /><form className="modal-card" role="dialog" aria-modal="true" aria-label="Add existing furniture" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">Your furniture</span><h2>Add an existing item</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div><p className="catalog-intro">Create an editable measured placeholder. It remains outside the shopping basket.</p><label className="field-label">Name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Type<select value={kind} onChange={(event) => setKind(event.target.value as CustomRoomItem['kind'])}><option value="furniture">Furniture</option><option value="rug">Rug</option><option value="wall">Wall item (picture, shelf, TV)</option></select></label><div className="form-grid"><label className="field-label">Width (cm)<input required type="number" min="1" max="2000" step="1" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label className="field-label">Depth (cm)<input required type="number" min="1" max="2000" step="1" value={depth} onChange={(event) => setDepth(event.target.value)} /></label><label className="field-label">Height (cm)<input required type="number" min="1" max="600" step="1" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label className="field-label">Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Place in room <Icon name="arrow" /></button></div></form></div>
}

function App() {
  const [project, renderProject] = useState<ProjectState>(loadProject)
  const projectRef = useRef(project)
  const lastStored = useRef<string | null>(null)
  const history = useRef<{ past: ProjectState[]; future: ProjectState[] }>({ past: [], future: [] })
  const dragSnapshot = useRef<ProjectState | null>(null)
  const [, refreshHistory] = useState(0)
  const [accountUser, setAccountUser] = useState<User | null>(null)
  const [accountReady, setAccountReady] = useState(!auth)
  const [cloudProjectId, setCloudProjectId] = useState<string | null>(null)
  const cloudProjectIdRef = useRef<string | null>(null)
  const cloudSavedProjectRef = useRef<string | null>(null)
  const cloudSavePromiseRef = useRef<Promise<SavedProject> | null>(null)
  const [cloudSaving, setCloudSaving] = useState(false)
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
  const setActiveCloudProject = (id: string | null) => {
    cloudProjectIdRef.current = id
    setCloudProjectId(id)
  }
  const detachCloudProject = () => {
    cloudSavedProjectRef.current = null; setActiveCloudProject(null)
    try { if (accountUser) localStorage.removeItem(cloudProjectKey(accountUser.uid)) } catch {}
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
  const cancelDrag = () => {
    const before = dragSnapshot.current
    dragSnapshot.current = null
    if (before) { projectRef.current = before; renderProject(before) }
    setDraggingId(null)
  }
  const [renderOpen, setRenderOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() => project.features.length ? '3d' : '2d')
  const [activeTool, setActiveTool] = useState<Tool>(() => project.features.length ? 'select' : 'wall')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
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
  const [lightingMode, setLightingMode] = useState<LightingMode>('default')
  const [cameraVersion, setCameraVersion] = useState(0)
  const [category, setCategory] = useState<CategoryFilter>('All')
  const [search, setSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved just now')
  const [shoppingOpen, setShoppingOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState<RoomTemplate | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [customItemOpen, setCustomItemOpen] = useState(false)
  const [measureOpen, setMeasureOpen] = useState(false)
  // A wall item waiting for the user to tap a wall, and the wall chosen from the mobile wall bar for the Add sheet.
  const [hangItem, setHangItem] = useState<RoomObject | null>(null)
  const [targetWallId, setTargetWallId] = useState<string | null>(null)
  const [sketchStrokes, setSketchStrokes] = useState<Point[][]>([])
  const [lengthWallId, setLengthWallId] = useState<string | null>(null)
  const [addPoint, setAddPoint] = useState<Point | null>(null)
  const [twistLabel, setTwistLabel] = useState<(ScreenPoint & { degrees: number }) | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const compact = useCompactLayout()
  const [step, setStep] = useState<Step>(() => getFloorRegions(project.features).length ? 'furnish' : 'room')
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia(COMPACT_QUERY).matches)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [projectName, setProjectName] = useState(project.name)
  useEffect(() => setProjectName(project.name), [project.name])
  useEffect(() => { setPanelOpen(!compact); setDetailsOpen(false) }, [compact])
  useEffect(() => { if (compact ? !addOpen : !panelOpen || step !== 'furnish') setAddPoint(null) }, [compact, addOpen, panelOpen, step])
  useEffect(() => { if (!compact) { setMenuOpen(false); setAddOpen(false) } }, [compact])
  useEffect(() => { if (!addOpen) setTargetWallId(null) }, [addOpen])
  const modalOpen = Boolean(shoppingOpen || newProjectOpen || requestOpen || importOpen || customItemOpen || measureOpen || lengthWallId)
  const openStep = (next: Step) => {
    if (compact && panelOpen && step === next) { setPanelOpen(false); return }
    setStep(next); setPanelOpen(true); setDetailsOpen(false); setViewMenuOpen(false)
    if (next !== 'room' && activeTool !== 'select') setActiveTool('select')
  }
  const chooseTool = (tool: Tool) => {
    clearSelection(); setActiveTool(tool); setViewMenuOpen(false); setHangItem(null)
    if (tool !== 'sketch') setSketchStrokes([])
    if (tool === 'sketch') setViewMode('2d')
    if (BUILD_TOOLS.includes(tool)) setWelcomeDismissed(true)
    if (compact) { setPanelOpen(false); setMenuOpen(false); setAddOpen(false) }
  }
  const openMobilePanel = (next: Step) => { setMenuOpen(false); setAddOpen(false); setDetailsOpen(false); setStep(next); setPanelOpen(true) }
  const openAddSheet = (wallId?: string) => {
    if (!project.features.length) { setWelcomeDismissed(false); return }
    if (!floors.length) { setNotice('Finish your walls first: tap the first corner again to close the room.'); return }
    clearSelection(); setMenuOpen(false); setPanelOpen(false); setAddOpen(true); setHangItem(null); setTargetWallId(wallId ?? null)
  }
  const tapEmptyCanvas = () => { clearSelection(); setAddOpen(false); if (hangItem) setNotice(`${compact ? 'Tap' : 'Click'} a wall to hang the ${roomItemShape(hangItem)?.name || 'item'}, or cancel.`) }
  const addOpeningToWall = (type: FeatureType) => {
    const wall = selectedFeature
    if (wall?.type !== 'wall') return
    addFeature(type, wall.x, wall.z)
  }

  useEffect(() => {
    if (!auth) { setAccountReady(true); return }
    return onAuthStateChanged(auth, (next) => {
      const current = next && !next.isAnonymous ? next : null
      let storedId: string | null = null
      try { if (current) storedId = localStorage.getItem(cloudProjectKey(current.uid)) } catch {}
      setAccountUser(current); setAccountReady(true); setActiveCloudProject(storedId); cloudSavedProjectRef.current = null
    })
  }, [])

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('projectId')
    if (!requestedId || !accountReady) return
    if (!accountUser) { window.location.replace(`/profile?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`); return }
    let current = true
    const clearRequestedId = () => { const url = new URL(window.location.href); url.searchParams.delete('projectId'); window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`) }
    setSaveStatus('Loading saved space…')
    void accountApi<SavedProjectDetails>(`/projects/${encodeURIComponent(requestedId)}`).then((saved) => {
      if (!current) return
      if (needsRecovery) { try { const original = localStorage.getItem(STORAGE_KEY); if (original) localStorage.setItem(`${STORAGE_KEY}-recovery-${Date.now()}`, original) } catch {}; needsRecovery = false }
      setProject(saved.project); history.current = { past: [], future: [] }; refreshHistory((value) => value + 1)
      setSelectedId(null); setSelectedIds([]); setSelectedFeatureId(null); setViewMode(saved.project.features.length ? '3d' : '2d'); setActiveTool(saved.project.features.length ? 'select' : 'wall'); setStep(getFloorRegions(saved.project.features).length ? 'furnish' : 'room')
      setActiveCloudProject(saved.id); cloudSavedProjectRef.current = JSON.stringify(saved.project)
      try { localStorage.setItem(cloudProjectKey(accountUser.uid), saved.id) } catch {}
      clearRequestedId(); setSaveStatus('Saved to profile')
    }).catch((reason) => {
      if (!current) return
      clearRequestedId(); setSaveStatus('Could not load saved space'); setNotice(reason instanceof Error ? reason.message : 'Could not load this saved space.')
    })
    return () => { current = false }
  }, [accountReady, accountUser])

  useEffect(() => {
    if (needsRecovery) { setSaveStatus('Recovery mode · save manually'); return }
    setSaveStatus('Unsaved changes')
    const timer = window.setTimeout(() => {
      try {
        const serialized = JSON.stringify(project)
        localStorage.setItem(STORAGE_KEY, serialized); lastStored.current = serialized
        setSaveStatus(cloudSavedProjectRef.current === serialized ? 'Saved to profile' : accountUser && cloudProjectId ? 'Saved on device · profile changes need Save' : 'Saved on this device')
      } catch { setSaveStatus('Save unavailable — export a backup') }
    }, 700)
    return () => clearTimeout(timer)
  }, [project, accountUser, cloudProjectId])
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
    if (!shoppingOpen && !newProjectOpen && !requestOpen && !importOpen && !customItemOpen && !measureOpen && !lengthWallId) return
    const previous = document.activeElement as HTMLElement | null
    const panel = document.querySelector<HTMLElement>('.modal-card, .shopping-drawer')
    const elements = () => Array.from(document.querySelector('.modal-card, .shopping-drawer')?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea') || [])
    const frame = requestAnimationFrame(() => (panel?.querySelector<HTMLElement>('input') || elements()[0])?.focus())
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setShoppingOpen(false); setNewProjectOpen(null); setRequestOpen(false); setImportOpen(false); setCustomItemOpen(false); setMeasureOpen(false); setLengthWallId(null) }
      if (event.key !== 'Tab') return
      const targets = elements(), first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keys)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keys); previous?.focus() }
  }, [shoppingOpen, newProjectOpen, requestOpen, importOpen, customItemOpen, measureOpen, lengthWallId])

  const selectedObjects = project.objects.filter((object) => selectedIds.includes(object.id))
  const selectedProductObjects = selectedObjects.filter((object) => object.productId)
  const allSelectedProductsInBasket = selectedProductObjects.length > 0 && selectedProductObjects.every((object) => object.inBasket)
  const selectedObject = selectedIds.length === 1 ? selectedObjects[0] ?? null : null
  const selectedProduct = selectedObject?.productId ? productById.get(selectedObject.productId) ?? null : null
  const selectedCustom = selectedObject?.custom ?? null
  const selectedCanMirror = Boolean(selectedProduct && /^(Corner sofa|Modular sofa)$/i.test(selectedProduct.category))
  const selectedFeature = project.features.find((feature) => feature.id === selectedFeatureId) ?? null
  const similarProducts = useMemo(() => {
    if (!selectedProduct) return []
    const sofaFamily = /sofa/i.test(selectedProduct.category)
    return products.filter((product) => product.id !== selectedProduct.id && (product.category === selectedProduct.category || (sofaFamily && /sofa/i.test(product.category))))
      .sort((a, b) => Number(b.category === selectedProduct.category) - Number(a.category === selectedProduct.category)).slice(0, 4)
  }, [selectedProduct])
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((product) => (category === 'All' || product.group === category) && (retailer === 'All' || product.retailer === retailer) && (!query || `${product.name} ${product.brand} ${product.category} ${product.retailer} ${product.sku || ''}`.toLowerCase().includes(query))).sort((a, b) => sort === 'price-low' ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === 'price-high' ? (b.price ?? -Infinity) - (a.price ?? -Infinity) : 0)
  }, [category, search, retailer, sort])

  const shoppingItems = useMemo(() => {
    const grouped = new Map<string, { id: string; product: Product; variantName?: string; quantity: number; subtotal: number | null }>()
    project.objects.forEach((object) => {
      if (!object.inBasket || !object.productId) return
      const product = productById.get(object.productId)
      if (!product) return
      const id = purchaseItemId(product.id, object.variantId), variantName = product.variants?.find((variant) => variant.id === object.variantId)?.name
      const current = grouped.get(id)
      if (current) {
        current.quantity += 1
        current.subtotal = current.subtotal === null || product.price === null ? null : current.subtotal + product.price
      } else grouped.set(id, { id, product, ...(variantName ? { variantName } : {}), quantity: 1, subtotal: product.price })
    })
    return [...grouped.values()]
  }, [project.objects])

  const estimatedTotal = shoppingItems.some((item) => item.subtotal === null) ? null : shoppingItems.reduce((total, item) => total + (item.subtotal ?? 0), 0)
  const itemCount = project.objects.filter((object) => object.inBasket && object.productId).length
  const warnings = useMemo(() => placementWarnings(project), [project])
  const floors = useMemo(() => getFloorRegions(project.features), [project.features])
  const floorArea = floors.reduce((sum, region) => sum + region.area, 0)

  const clearSelection = () => {
    setSelectedId(null)
    setSelectedIds([])
    setSelectedFeatureId(null)
    setDetailsOpen(false)
  }

  const selectObject = (id: string, extend = false) => {
    const nextIds = extend ? [...new Set([...selectedIds, id])] : [id]
    setSelectedId(id)
    setSelectedIds(nextIds)
    setSelectedFeatureId(null)
    setActiveTool('select')
    if (compact) { setPanelOpen(false); setDetailsOpen(false); setAddOpen(false); setMenuOpen(false) }
  }

  const selectFeature = (id: string) => {
    setSelectedFeatureId(id)
    setSelectedId(null)
    setSelectedIds([])
    setActiveTool('select')
    if (compact) { setPanelOpen(false); setDetailsOpen(false); setAddOpen(false); setMenuOpen(false) }
  }

  const patchProject = (patch: Partial<ProjectState>) => setProject((current) => {
    const next = { ...current, ...patch }
    next.width = clamp(next.width, current.width, 40)
    next.length = clamp(next.length, current.length, 40)
    next.ceilingHeight = clamp(next.ceilingHeight, 2, 6)
    return refreshOpenings(next)
  })

  const hangNewItem = (object: RoomObject, wallId?: string, point?: Point) => {
    const current = projectRef.current, name = roomItemShape(object)?.name || 'Item'
    const hung = hangOnWall({ ...object, wallId }, current, point, Boolean(point))
    setHangItem(null); setTargetWallId(null); setAddOpen(false); setDragProduct(null); setAddPoint(null)
    if (!hung || (point && !wallId && Math.hypot(hung.x - point.x, hung.z - point.z) > 1.6)) { setNotice(hung ? `${compact ? 'Tap' : 'Click'} closer to a wall to hang the ${name}.` : `No wall is wide enough for the ${name}.`); return }
    setProject({ ...current, objects: [...current.objects, hung] })
    selectObject(hung.id)
    setNotice(`${name} hung on the wall. Drag it along the wall, or set its height in ${compact ? 'Details' : 'the panel'}.`)
  }
  // Wall items go on the chosen or selected wall, near a given point, or wait for the user to tap a wall.
  const placeWallItem = (object: RoomObject, point?: Point) => {
    const wallId = targetWallId ?? (selectedFeature?.type === 'wall' ? selectedFeature.id : undefined)
    if (wallId || point) { hangNewItem(object, wallId, point); return }
    clearSelection(); setAddOpen(false); setPanelOpen(!compact && panelOpen); setActiveTool('select'); setHangItem(object)
    setNotice(`${compact ? 'Tap' : 'Click'} a wall to hang the ${roomItemShape(object)?.name || 'item'}.`)
  }
  const tapFeature = (id: string, point?: Point) => {
    const feature = projectRef.current.features.find((candidate) => candidate.id === id)
    if (hangItem && feature) { hangNewItem(hangItem, feature.type === 'wall' ? feature.id : feature.wallId, point); return }
    selectFeature(id)
  }

  const addProduct = (productId: string, x?: number, z?: number, nearest = x === undefined) => {
    const product = productById.get(productId)
    if (!product) return
    const current = projectRef.current, regions = getFloorRegions(current.features)
    setDragProduct(null)
    setAddPoint(null)
    if (!regions.length) { setNotice('Close a loop of walls first. The floor will fill automatically.'); return }
    const defaultVariantId = product.variants?.[0]?.id, target = { x: x ?? 0, z: z ?? 0 }
    if (product.mount === 'wall') { placeWallItem({ id: makeId('object'), productId, ...(defaultVariantId ? { variantId: defaultVariantId } : {}), x: 0, z: 0, rotation: 0, inBasket: false }, x === undefined ? undefined : target); return }
    let object = placeObject({ id: makeId('object'), productId, ...(defaultVariantId ? { variantId: defaultVariantId } : {}), ...target, rotation: 0, inBasket: false }, current, snap, wallSnap)
    if (nearest) {
      const candidates: RoomObject[] = [object]
      for (let px = -current.width / 2; px <= current.width / 2; px += 0.25) for (let pz = -current.length / 2; pz <= current.length / 2; pz += 0.25) candidates.push(placeObject({ ...object, x: px, z: pz }, current, snap, wallSnap))
      const valid = candidates.filter((candidate) => fitsFloor(candidate, current, regions)).sort((a, b) => (a.x - target.x) ** 2 + (a.z - target.z) ** 2 - (b.x - target.x) ** 2 - (b.z - target.z) ** 2)
      object = valid.find((candidate) => current.objects.every((o) => !overlaps(candidate, o))) || valid[0] || object
    }
    if (!fitsFloor(object, current, regions)) { setNotice(nearest ? 'There is no free space for this piece in your room.' : 'This piece must fit entirely inside an enclosed room.'); return }
    setProject({ ...current, objects: [...current.objects, object] })
    setAddOpen(false)
    selectObject(object.id)
    setDragProduct(null)
    setNotice(`${product.name} added to your room`)
  }

  const addAt = (x: number, z: number) => {
    const regions = getFloorRegions(projectRef.current.features), point = { x, z }
    if (!regions.length) { setNotice('Draw your walls first, then double-tap inside the room to add furniture.'); return }
    if (!regions.some((region) => pointInPolygon(point, region.points) && !region.holes.some((hole) => pointInPolygon(point, hole)))) { setNotice(`${compact ? 'Double-tap' : 'Double-click'} inside a room to add furniture there.`); return }
    clearSelection()
    setAddPoint(point)
    if (compact) { setPanelOpen(false); setMenuOpen(false); setAddOpen(true) }
    else { setStep('furnish'); setPanelOpen(true); setViewMenuOpen(false) }
    setNotice(compact ? 'Pick a piece to place it where you tapped.' : 'Pick a piece to place it on the marked spot.')
  }

  const addCustomObject = (custom: CustomRoomItem) => {
    const current = projectRef.current, regions = getFloorRegions(current.features)
    setCustomItemOpen(false)
    if (!regions.length) { setNotice('Close a loop of walls before adding existing furniture.'); return }
    let object: RoomObject = { id: makeId('object'), custom, x: 0, z: 0, rotation: 0, inBasket: false }
    if (custom.kind === 'wall') { placeWallItem(object); return }
    const candidates: RoomObject[] = [object]
    for (let x = -current.width / 2; x <= current.width / 2; x += 0.25) for (let z = -current.length / 2; z <= current.length / 2; z += 0.25) candidates.push(placeObject({ ...object, x, z }, current, snap, wallSnap))
    const valid = candidates.filter((candidate) => fitsFloor(candidate, current, regions)).sort((a, b) => a.x ** 2 + a.z ** 2 - b.x ** 2 - b.z ** 2)
    object = valid.find((candidate) => current.objects.every((existing) => !overlaps(candidate, existing))) || valid[0] || object
    if (!fitsFloor(object, current, regions)) { setNotice('This item must fit inside an enclosed room.'); return }
    setProject({ ...current, objects: [...current.objects, object] })
    selectObject(object.id)
    setNotice(`${custom.name} added as existing furniture; it is not in the basket.`)
  }

  const patchObject = (patch: Partial<RoomObject>) => {
    if (!selectedId) return
    const current = projectRef.current, object = current.objects.find((o) => o.id === selectedId)
    if (!object) return
    const next = isWallMounted(object) ? hangOnWall({ ...object, ...patch }, current) : placeObject({ ...object, ...patch }, current)
    if (!next || !fitsFloor(next, current)) { setNotice(next ? 'Keep the whole piece inside a closed room, clear of walls.' : 'This item needs a wall to hang on.'); return }
    setProject({ ...current, objects: current.objects.map((o) => o.id === selectedId ? next : o) })
  }

  const flipSelected = () => {
    if (!selectedObject || !selectedCanMirror) return
    patchObject({ mirrored: !selectedObject.mirrored })
  }

  const rotateSelection = () => {
    if (!selectedObjects.length) return
    const next = rotateObjects(projectRef.current, selectedObjects.map((object) => object.id), Math.PI / 12)
    if (!next) { setNotice(selectedObjects.some(isWallMounted) ? 'Wall items turn with their wall. Drag them along it instead.' : selectedObjects.length > 1 ? 'The group rotation would move an item outside the room.' : 'Keep the whole piece inside a closed room, clear of walls.'); return }
    setProject(next)
  }

  // Two-finger twist on a selected item: rotate live from the gesture's starting snapshot, committed as one undo step.
  const twistTo = (ids: string[], screenTwist: number, at: ScreenPoint) => {
    const base = dragSnapshot.current ??= projectRef.current
    const primary = base.objects.find((object) => object.id === ids[0])
    if (!primary) return
    // Seen from above, a clockwise twist on screen is a negative turn about +Y.
    const target = snapRotation(primary.rotation - screenTwist), next = rotateObjects(base, ids, target - primary.rotation)
    if (next) setProject(next)
    setTwistLabel({ ...at, degrees: ((Math.round(target * 180 / Math.PI) % 360) + 360) % 360 })
  }
  const endTwist = () => { setTwistLabel(null); if (dragSnapshot.current) endDrag() }
  const twistHandlers = useRef({ twistTo, endTwist, selectedIds, activeTool })
  twistHandlers.current = { twistTo, endTwist, selectedIds, activeTool }
  useEffect(() => {
    const points = new Map<number, ScreenPoint>()
    let gesture: { ids: string[]; start: TwoFinger; angle: number; twist: number; mode: TwoFingerMode } | null = null
    const pair = () => [...points.values()].slice(0, 2) as TwoFinger
    const finish = () => { if (gesture?.mode === 'rotate') twistHandlers.current.endTwist(); gesture = null }
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      if (event.isPrimary) { points.clear(); gesture = null }
      if (!(event.target instanceof Element && event.target.closest('.canvas-frame'))) return
      points.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const { selectedIds: ids, activeTool: tool } = twistHandlers.current
      if (points.size === 2 && ids.length && tool === 'select') { const start = pair(); gesture = { ids, start, angle: fingerAngle(start), twist: 0, mode: 'pending' } }
      else if (points.size > 2) finish()
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !points.has(event.pointerId)) return
      points.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!gesture || gesture.mode === 'zoom' || points.size !== 2) return
      const current = pair(), angle = fingerAngle(current)
      gesture.twist += angleStep(gesture.angle, angle); gesture.angle = angle
      if (gesture.mode === 'pending') gesture.mode = classifyTwoFinger(gesture.twist, fingerSpan(current) / Math.max(1, fingerSpan(gesture.start)))
      if (gesture.mode === 'zoom') return
      // Hold the camera still (OrbitControls and R3F never see these moves) until the gesture is known, and for the whole rotate.
      event.stopPropagation()
      if (gesture.mode === 'rotate') twistHandlers.current.twistTo(gesture.ids, gesture.twist, fingerMidpoint(current))
    }
    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      points.delete(event.pointerId)
      if (points.size < 2) finish()
    }
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true)
    }
  }, [])

  const moveSelectionBy = (dx: number, dz: number) => {
    if (selectedObjects.length < 2) return
    const current = projectRef.current, ids = new Set(selectedObjects.map((object) => object.id))
    const next = current.objects.map((object) => ids.has(object.id) ? { ...object, x: object.x + dx, z: object.z + dz } : object)
    if (next.some((object) => ids.has(object.id) && !fitsFloor(object, current))) { setNotice('The whole selection must stay inside the room.'); return }
    setProject({ ...current, objects: next })
  }

  const replaceSelected = (productId: string) => {
    if (!selectedObject) return
    const product = productById.get(productId)
    if (!product) return
    const current = projectRef.current, previous = current.objects.find((object) => object.id === selectedObject.id)
    if (!previous) return
    const swapped = { ...previous, productId, variantId: product.variants?.[0]?.id, mirrored: /^(Corner sofa|Modular sofa)$/i.test(product.category) ? previous.mirrored : undefined }
    const replacement = isWallMounted(swapped) ? hangOnWall(swapped, current) ?? swapped : swapped
    setProject({ ...current, objects: current.objects.map((object) => object.id === previous.id ? replacement : object) })
    setNotice(fitsFloor(replacement, current) ? `${product.name} replaced in place` : `${product.name} replaced in place; its new dimensions may not fit the room.`)
  }

  const toggleBasket = () => {
    const items = project.objects.filter((object) => selectedIds.includes(object.id) && object.productId)
    if (!items.length) return
    const inBasket = !items.every((object) => object.inBasket)
    const ids = new Set(items.map((object) => object.id))
    setProject((current) => ({ ...current, objects: current.objects.map((object) => ids.has(object.id) ? { ...object, inBasket } : object) }))
    setNotice(`${items.length === 1 ? selectedProduct?.name || 'Item' : `${items.length} products`} ${inBasket ? 'added to' : 'removed from'} basket`)
  }

  const moveObject = (id: string, x: number, z: number, y?: number) => {
    const current = projectRef.current, base = dragSnapshot.current || current, origin = base.objects.find((object) => object.id === id)
    if (!origin) return
    if (isWallMounted(origin)) {
      // Wall items slide along their own wall (and up/down in 3D); they never leave it by dragging.
      const existing = current.objects.find((object) => object.id === id)
      const hung = existing && hangOnWall({ ...existing, ...(y === undefined ? {} : { elevation: Math.max(0, y) }) }, current, { x, z })
      if (hung) setProject({ ...current, objects: current.objects.map((object) => object.id === id ? hung : object) })
      return
    }
    const ids = selectedIds.includes(id) ? selectedIds : [id], moved = new Map<string, RoomObject>()
    for (const selected of ids) {
      const original = base.objects.find((object) => object.id === selected), existing = current.objects.find((object) => object.id === selected)
      if (!original || !existing || isWallMounted(original)) continue
      const next = placeObject({ ...existing, x: original.x + x - origin.x, z: original.z + z - origin.z }, current, snap, wallSnap)
      if (!fitsFloor(next, current, floors)) return
      moved.set(selected, next)
    }
    if (moved.size) setProject({ ...current, objects: current.objects.map((object) => moved.get(object.id) || object) })
  }

  const duplicateSelected = () => {
    const selected = project.objects.filter((object) => selectedIds.includes(object.id))
    if (!selected.length) return
    const duplicates = selected.map((object) => {
      const id = makeId('object')
      if (isWallMounted(object)) return hangOnWall({ ...object, id, inBasket: false, wallOffset: (object.wallOffset ?? 0) + (roomItemShape(object)?.width ?? 0) / 100 + 0.1 }, project) ?? { ...object, id, inBasket: false }
      let duplicate = placeObject({ ...object, id, x: object.x + 0.35, z: object.z + 0.35, inBasket: false }, project)
      if (!fitsFloor(duplicate, project)) duplicate = { ...object, id, inBasket: false }
      return duplicate
    })
    if (duplicates.some((object) => !fitsFloor(object, project))) { setNotice('Repair the room boundary before duplicating these items.'); return }
    setProject((current) => ({ ...current, objects: [...current.objects, ...duplicates] }))
    const ids = duplicates.map((object) => object.id)
    setSelectedIds(ids); setSelectedId(ids[ids.length - 1]); setSelectedFeatureId(null)
  }

  const deleteSelected = () => {
    const ids = new Set(selectedIds)
    if (!ids.size) return
    setProject((current) => ({ ...current, objects: current.objects.filter((object) => !ids.has(object.id)) }))
    clearSelection()
  }

  const addFeature = (type: FeatureType, x: number, z: number) => {
    if (type === 'wall') return
    const current = projectRef.current
    if (current.features.length >= 200) { setNotice('This prototype supports up to 200 walls and openings.'); return }
    const feature = attachOpening({ id: makeId(type), type, x, z, rotation: 0, width: type === 'door' ? 0.8 : 1.2, height: type === 'door' ? 2.1 : 1.4, sillHeight: type === 'window' ? 0.9 : 0 }, current)
    if (!feature.wallId || Math.hypot(feature.x - x, feature.z - z) > 0.65) { setNotice(`Click a drawn wall to place the ${type}.`); return }
    setProject({ ...current, features: [...current.features, feature] })
    // Placing one opening ends the tool, so the next drag moves the view instead of adding another.
    selectFeature(feature.id)
    setNotice(`${type === 'door' ? 'Door' : 'Window'} added. Drag it along the wall, or choose its type and size in ${compact ? 'Details' : 'the panel'}.`)
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
        return { ...(f.id === edited.id ? edited : f), ...wallFromPoints(f.id, ends[0], ends[1], f.id === edited.id ? edited.height : f.height) }
      })
      if (features.some((f) => f.type === 'wall' && (f.width < 0.25 || wallEndpoints(f).some((p) => Math.abs(p.x) > current.width / 2 || Math.abs(p.z) > current.length / 2)))) return current
      return refreshOpenings({ ...current, features })
    })
  }

  const moveOpening = (id: string, wallOffset: number) => {
    setProject((current) => {
      const feature = current.features.find((candidate) => candidate.id === id)
      if (!feature || feature.type === 'wall') return current
      const next = attachOpening({ ...feature, wallOffset }, current)
      return { ...current, features: current.features.map((candidate) => candidate.id === id ? next : candidate) }
    })
  }

  const deleteFeature = () => {
    if (!selectedFeatureId) return
    setProject((current) => ({ ...current, features: current.features.filter((feature) => feature.id !== selectedFeatureId && feature.wallId !== selectedFeatureId) }))
    clearSelection()
  }

  const saveCloudProject = async (value: ProjectState) => {
    const serialized = JSON.stringify(value)
    if (cloudSavePromiseRef.current) {
      try { await cloudSavePromiseRef.current } catch {}
      if (cloudProjectIdRef.current && cloudSavedProjectRef.current === serialized) return cloudProjectIdRef.current
    }
    const operation = (async () => {
      const user = auth?.currentUser
      if (!user || user.isAnonymous) throw new Error('Sign in to save this space to your profile.')
      const body = JSON.stringify({ project: value }), id = cloudProjectIdRef.current
      let saved: SavedProject
      if (id) {
        try { saved = await accountApi<SavedProject>(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body }) }
        catch (reason) {
          if (!(reason instanceof AccountApiError) || reason.status !== 404) throw reason
          saved = await accountApi<SavedProject>('/projects', { method: 'POST', body })
        }
      } else saved = await accountApi<SavedProject>('/projects', { method: 'POST', body })
      setActiveCloudProject(saved.id); cloudSavedProjectRef.current = serialized
      try { localStorage.setItem(cloudProjectKey(user.uid), saved.id) } catch {}
      return saved
    })()
    cloudSavePromiseRef.current = operation
    try { return (await operation).id }
    finally { if (cloudSavePromiseRef.current === operation) cloudSavePromiseRef.current = null }
  }

  const saveProject = () => {
    const serialized = JSON.stringify(project)
    try {
      if (needsRecovery) {
        const original = localStorage.getItem(STORAGE_KEY)
        if (original) localStorage.setItem(`${STORAGE_KEY}-recovery-${Date.now()}`, original)
      }
      window.localStorage.setItem(STORAGE_KEY, serialized)
      lastStored.current = serialized
      needsRecovery = false
      if (window.location.hash.startsWith('#project=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setSaveStatus('Saved on this device')
    } catch { setSaveStatus('Save unavailable'); return }
    if (!accountUser || cloudSaving) return
    setCloudSaving(true); setSaveStatus('Saving to your profile…')
    void saveCloudProject(project).then(() => {
      setSaveStatus(JSON.stringify(projectRef.current) === serialized ? 'Saved to profile' : 'Newer changes remain on this device; save again to sync')
    }).catch((reason) => {
      setSaveStatus('Saved on this device · profile sync failed')
      setNotice(reason instanceof Error ? reason.message : 'Could not sync this space to your profile.')
    }).finally(() => setCloudSaving(false))
  }

  const exportList = () => {
    const rows = [['Product', 'Variant', 'Brand', 'Retailer', 'SKU', 'Quantity', 'Width cm', 'Depth cm', 'Height cm', 'Unit price EUR', 'Subtotal EUR', 'Verification status']]
    shoppingItems.forEach(({ product, variantName, quantity, subtotal }) => rows.push([product.name, variantName || '', product.brand, product.retailer, product.sku || '', String(quantity), String(product.width), String(product.depth), String(product.height), String(product.price ?? ''), String(subtotal ?? ''), product.status]))
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

  const submitPurchaseRequest = async (customer: { name: string; phone: string; city: string; notes: string }) => {
    const projectId = await saveCloudProject(projectRef.current)
    await accountApi('/purchase-requests', { method: 'POST', body: JSON.stringify({ projectId, customer }) })
    setNotice('Purchase request sent. Follow updates from your profile.')
  }

  const buildAction = (action: BuildAction) => {
    const current = projectRef.current
    if (action.tool === 'sketch') { setSketchStrokes((strokes) => [...strokes, action.points]); return }
    if (action.tool === 'erase') {
      const next = eraseWallSegment(current, action.a, action.b, () => makeId('wall'))
      if (next === current) setNotice(`Drag along a wall to remove part of it, or ${compact ? 'tap' : 'click'} a wall to remove all of it.`)
      else setProject(next)
      return
    }
    if (current.features.length >= 196) { setNotice('This prototype supports up to 200 walls and openings.'); return }
    const { a, b } = action
    if (action.tool === 'room' && (Math.abs(b.x - a.x) < 0.5 || Math.abs(b.z - a.z) < 0.5)) { setNotice('Drag a bigger box: at least 50 cm each way.'); return }
    const corners = [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }]
    const segments: [Point, Point][] = action.tool === 'room' ? corners.map((p, i) => [p, corners[(i + 1) % 4]]) : [[a, b]]
    const next = segments.reduce((project, [p, q]) => addWallSegment(project, p, q, makeId('wall')), current)
    if (next === current) return
    const closesRoom = getFloorRegions(next.features).length > getFloorRegions(current.features).length
    if (closesRoom) setNotice(compact ? 'Room finished. Tap a wall to add a door or window, or tap Add furniture.' : 'Room enclosed. Your floor is ready to furnish.')
    if (closesRoom && compact) setActiveTool('select')
    setProject(next)
  }
  const finishSketch = () => {
    const segments = wallsFromSketch(sketchStrokes)
    setSketchStrokes([])
    if (!segments.length) { setNotice('Draw the outline of your room first.'); return }
    setProject(segments.reduce((project, [a, b]) => addWallSegment(project, a, b, makeId('wall')), projectRef.current))
    clearSelection(); setActiveTool('select'); setWelcomeDismissed(true); setCameraVersion((value) => value + 1)
    setNotice(`${segments.length} walls made from your sketch. ${compact ? 'Tap' : 'Click'} a wall's length to type its exact size.`)
  }
  const eraseFeature = (id: string) => setProject((current) => refreshOpenings({ ...current, features: current.features.filter((feature) => feature.id !== id && feature.wallId !== id) }))
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (renderOpen || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || shoppingOpen || requestOpen || newProjectOpen || importOpen || customItemOpen || measureOpen || lengthWallId) return
      if (event.key === 'Escape') { clearSelection(); setActiveTool('select'); setHangItem(null); setSketchStrokes([]); endDrag(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return }
      if (event.key === '/') { event.preventDefault(); setStep('furnish'); setPanelOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search-field input')?.focus()); return }
      if (selectedFeatureId && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteFeature(); return }
      const shortcut = !event.metaKey && !event.ctrlKey && !event.altKey ? ({ v: 'select', w: 'wall', b: 'room', e: 'erase', d: 'door', n: 'window' } as Record<string, Tool>)[event.key.toLowerCase()] : undefined
      if (shortcut) { chooseTool(shortcut); return }
      if (selectedObjects.length > 1) {
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return }
        if (event.key.toLowerCase() === 'r') { rotateSelection(); return }
        const delta = event.shiftKey ? 0.1 : 0.01
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          moveSelectionBy(event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0, event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0)
        }
        return
      }
      if (!selectedObject) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      if (event.key.toLowerCase() === 'r') rotateSelection()
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
    detachCloudProject()
    setProject(nextProject)
    clearSelection()
    setNewProjectOpen(null)
    setViewMode('2d')
    const enclosed = getFloorRegions(nextProject.features).length > 0
    setActiveTool(enclosed ? 'select' : 'wall')
    setStep(enclosed ? 'furnish' : 'room')
    if (!nextProject.features.length) setWelcomeDismissed(false)
    setMenuOpen(false); setAddOpen(false)
    setGridVisible(true)
    setCameraVersion((value) => value + 1)
  }

  const createQuickRoom = (width: number, length: number) => {
    if (![width, length].every((value) => Number.isFinite(value) && value >= 1 && value <= 38)) { setNotice('Enter a width and length between 1 and 38 m.'); return }
    const w = Math.round(width * 20) / 20, l = Math.round(length * 20) / 20
    setProject((current) => ({ ...current, width: Math.max(current.width, Math.ceil(w + 2)), length: Math.max(current.length, Math.ceil(l + 2)), features: rectangleWalls(w, l, current.ceilingHeight) }))
    clearSelection(); setActiveTool('select'); setCameraVersion((value) => value + 1)
    if (compact) setPanelOpen(false)
    setNotice(`${w} × ${l} m room created. Drag a corner to reshape it, or add doors and windows.`)
  }

  const buildMeasuredRoom = (nextProject: ProjectState, summary: string) => {
    if (window.location.hash.startsWith('#project=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    detachCloudProject()
    setProject(nextProject)
    clearSelection()
    setMeasureOpen(false)
    setViewMode('3d')
    setActiveTool('select')
    setStep('room')
    if (compact) setPanelOpen(false)
    setCameraVersion((value) => value + 1)
    setNotice(summary)
  }

  const toggleObjectBasket = (id: string) => setProject((current) => ({ ...current, objects: current.objects.map((object) => object.id === id && object.productId ? { ...object, inBasket: !object.inBasket } : object) }))
  const addAllToBasket = () => setProject((current) => ({ ...current, objects: current.objects.map((object) => object.productId ? { ...object, inBasket: true } : object) }))
  const commitProjectName = () => {
    const name = projectName.trim().slice(0, 80)
    if (!name) { setProjectName(project.name); return }
    if (name !== project.name) setProject((current) => ({ ...current, name }))
  }

  const importProject = (nextProject: ProjectState) => {
    if (window.location.hash.startsWith('#project=')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    detachCloudProject()
    setProject(nextProject)
    clearSelection()
    setImportOpen(false)
    setViewMode('2d')
    setActiveTool('select')
    setStep('room')
    setGridVisible(true)
    setCameraVersion((value) => value + 1)
    setNotice(`${nextProject.planImport?.provider === 'vertex-ai' ? 'AI' : 'Local fallback'} floor plan imported. Geometry and inferred dimensions remain approximate${nextProject.planImport?.scaleCalibrated ? '; scale calibrated' : ''}.`)
  }

  const hasSelection = selectedObjects.length > 0 || Boolean(selectedFeature)
  const wallCount = project.features.filter((f) => f.type === 'wall').length
  const selectionWarnings = warnings.filter((warning) => selectedIds.includes(warning.id))
  const placedCounts = useMemo(() => project.objects.reduce((counts, object) => object.productId ? counts.set(object.productId, (counts.get(object.productId) || 0) + 1) : counts, new Map<string, number>()), [project.objects])
  const stepDone: Record<Step, boolean> = { room: floors.length > 0, furnish: project.objects.length > 0, review: itemCount > 0 }
  const steps: { id: Step; label: string; meta: string }[] = [
    { id: 'room', label: 'Room', meta: floors.length ? `${floorArea.toFixed(1)} m²` : 'Draw walls' },
    { id: 'furnish', label: 'Furnish', meta: project.objects.length ? `${project.objects.length} ${project.objects.length === 1 ? 'item' : 'items'}` : 'Add pieces' },
    { id: 'review', label: 'Review', meta: itemCount ? `${itemCount} in basket` : 'Shop' },
  ]
  const stepNav = (className: string) => <nav className={className} aria-label="Planner steps">{steps.map((item, index) => <button key={item.id} type="button" className={`step-button ${step === item.id && panelOpen ? 'step-active' : ''} ${stepDone[item.id] ? 'step-done' : ''}`} aria-current={step === item.id ? 'step' : undefined} aria-label={`${item.label} step`} onClick={() => openStep(item.id)}><span className="step-index">{stepDone[item.id] ? <Icon name="check" size={12} /> : index + 1}</span><span className="step-text"><strong>{item.label}</strong><small>{item.meta}</small></span></button>)}</nav>
  const collapsePanel = compact ? undefined : () => setPanelOpen(false)
  const tools: [Tool, string, IconName, string][] = [['select', 'Select', 'pointer', 'V'], ['wall', 'Wall', 'wall', 'W'], ['room', 'Room', 'grid', 'B'], ['erase', 'Erase', 'trash', 'E'], ['door', 'Door', 'door', 'D'], ['window', 'Window', 'window', 'N']]
  const tap = compact ? 'Tap' : 'Click'
  const canvasTip = hangItem ? `Click the wall where the ${roomItemShape(hangItem)?.name || 'item'} should go · Esc cancels`
    : activeTool === 'wall' ? 'Drag along the grid to draw a wall · ends join nearby walls · right-drag turns the 3D view · Esc stops'
    : activeTool === 'room' ? 'Drag a box to add a room with four walls · it shares walls with rooms next to it'
    : activeTool === 'erase' ? 'Drag along a wall to remove part of it · click a wall, door or window to remove it'
    : activeTool === 'sketch' ? 'Draw the outline of your room · lift and keep going · then press Make walls'
    : activeTool !== 'select' ? `${tap} any wall to place a ${activeTool}`
      : selectedObject && isWallMounted(selectedObject) ? 'Drag to slide it along the wall · set its height in the panel · Delete removes'
      : selectedObject ? compact ? 'Drag to move · use the toolbar to rotate or remove' : 'Drag to move · R rotates · arrow keys nudge · Delete removes'
        : selectedFeature?.type === 'wall' ? 'Drag the round handles to reshape this wall'
          : selectedFeature ? 'Drag the opening along its wall'
            : viewMode === '3d' ? compact ? 'Drag to orbit · pinch to zoom' : 'Drag to orbit · right-drag to pan · scroll to zoom'
              : compact ? 'Tap an item or wall to edit it' : `Click an item or wall to edit it · right-drag to pan · scroll to zoom`

  const similarStrip = selectedProduct && similarProducts.length > 0 ? <div className="similar-strip" role="group" aria-label={`Similar ${selectedProduct.category} products`}>
    <span className="similar-heading">Swap for something similar</span>
    <div className="similar-list">{similarProducts.map((product) => <button className="similar-product" key={product.id} title={`Replace with ${product.name}`} aria-label={`Replace with ${product.name}`} onClick={() => replaceSelected(product.id)}><ProductThumb product={product} compact /><span>{product.name}<small>{formatPrice(product.price)}</small></span></button>)}</div>
  </div> : null

  const selectionActions = selectedObjects.length > 1 ? <div className="selection-toolbar" role="toolbar" aria-label="Multi-selection controls">
    <button title="Rotate 15° (R)" aria-label="Rotate selected items 15 degrees" onClick={rotateSelection}><Icon name="rotate" /><span>Rotate</span></button>
    <button title="Duplicate" aria-label="Duplicate selected items" onClick={duplicateSelected}><Icon name="copy" /><span>Duplicate</span></button>
    {selectedProductObjects.length > 0 && <button className={`basket-action ${allSelectedProductsInBasket ? 'basket-action-on' : ''}`} title={allSelectedProductsInBasket ? 'Remove from basket' : 'Add to basket'} aria-label={allSelectedProductsInBasket ? 'Remove selected products from basket' : 'Add selected products to basket'} aria-pressed={allSelectedProductsInBasket} onClick={toggleBasket}><Icon name={allSelectedProductsInBasket ? 'check' : 'shopping'} /><span>{allSelectedProductsInBasket ? 'In basket' : 'Add to basket'}</span></button>}
    <button className="delete-action" title="Delete (Del)" aria-label="Delete selected items" onClick={deleteSelected}><Icon name="trash" /><span>Delete</span></button>
  </div> : selectedObject ? <div className="selection-toolbar" role="toolbar" aria-label={selectedCustom ? 'Selected existing furniture controls' : 'Selected furniture controls'}>
    {!isWallMounted(selectedObject) && <button title="Rotate 15° (R)" aria-label="Rotate selected object 15 degrees" onClick={rotateSelection}><Icon name="rotate" /><span>Rotate</span></button>}
    {selectedCanMirror && <button title="Flip left/right" aria-label="Flip sofa orientation" aria-pressed={Boolean(selectedObject.mirrored)} onClick={flipSelected}><Icon name="flip" /><span>Flip</span></button>}
    <button title="Duplicate" aria-label="Duplicate selected object" onClick={duplicateSelected}><Icon name="copy" /><span>Duplicate</span></button>
    {selectedProduct && <button className={`basket-action ${selectedObject.inBasket ? 'basket-action-on' : ''}`} title={selectedObject.inBasket ? 'Remove from basket' : 'Add to basket'} aria-label={selectedObject.inBasket ? 'Remove selected object from basket' : 'Add selected object to basket'} aria-pressed={Boolean(selectedObject.inBasket)} onClick={toggleBasket}><Icon name={selectedObject.inBasket ? 'check' : 'shopping'} /><span>{selectedObject.inBasket ? 'In basket' : 'Add to basket'}</span></button>}
    <button className="delete-action" title="Delete (Del)" aria-label="Delete selected object" onClick={deleteSelected}><Icon name="trash" /><span>Delete</span></button>
  </div> : selectedFeature ? <div className="selection-toolbar" role="toolbar" aria-label="Selected architecture controls">
    {compact && selectedFeature.type === 'wall' && <>
      <button aria-label="Add a door to this wall" onClick={() => addOpeningToWall('door')}><Icon name="door" /><span>Add door</span></button>
      <button aria-label="Add a window to this wall" onClick={() => addOpeningToWall('window')}><Icon name="window" /><span>Add window</span></button>
      <button aria-label="Hang something on this wall" onClick={() => openAddSheet(selectedFeature.id)}><Icon name="image" /><span>Wall item</span></button>
    </>}
    <button className="delete-action" title={`Delete ${selectedFeature.type}`} aria-label={`Delete selected ${selectedFeature.type}`} onClick={deleteFeature}><Icon name="trash" /><span>Delete</span></button>
  </div> : null

  const inspectorContent = selectedProduct && selectedObject ? <ObjectProperties onClose={clearSelection} object={selectedObject} product={selectedProduct} actions={selectionActions} similar={similarStrip} onPatch={patchObject} />
    : selectedCustom && selectedObject ? <CustomObjectProperties object={{ ...selectedObject, custom: selectedCustom }} actions={selectionActions} onClose={clearSelection} onPatch={patchObject} />
      : selectedObjects.length > 1 ? <><div className="inspector-heading"><div><span className="eyebrow">Group</span><h2>{selectedObjects.length} items selected</h2></div><button className="icon-button" title="Clear selection" aria-label="Clear selection" onClick={clearSelection}><Icon name="close" /></button></div>{selectionActions}<ul className="group-list">{selectedObjects.map((object) => <li key={object.id}>{roomItemShape(object)?.name || 'Item'}{object.productId && object.inBasket ? <span>In basket</span> : null}</li>)}</ul><p className="muted">Shift-click items to add them to the group. Drag any selected item to move them all.</p></>
        : selectedFeature ? <FeatureProperties project={project} feature={selectedFeature} onPatch={patchFeature} onDelete={deleteFeature} onClose={clearSelection} /> : null

  const furnishPanel = <>
    <div className="panel-scroll">
      <PanelHeader step={2} title="Furnish your room" intro={compact ? 'Tap a piece to place it in your room.' : 'Click a piece to place it, or drag it onto the plan.'} onCollapse={collapsePanel} />
      {!floors.length && <div className="callout"><strong>Close your walls first</strong><span>Furniture needs a finished floor. Draw a closed outline, or enter a room size.</span><button type="button" className="secondary-button" onClick={() => openStep('room')}>Go to Room</button></div>}
      <label className="search-field"><Icon name="search" /><input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" />{!compact && <kbd>/</kbd>}</label>
      <div className="category-row" role="group" aria-label="Categories">{categories.map((item) => <button key={item} className={category === item ? 'category-active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="catalog-filters"><select aria-label="Retailer filter" value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="All">All retailers</option>{[...new Set(products.map((p) => p.retailer))].map((r) => <option key={r}>{r}</option>)}</select><select aria-label="Sort products" value={sort} onChange={(event) => setSort(event.target.value)}><option value="curated">Curated order</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></div>
      <div className="catalog-results"><span>{filteredProducts.length} {filteredProducts.length === 1 ? 'piece' : 'pieces'}</span><span>Sample collection</span></div>
      <div className="product-list">{filteredProducts.map((product) => <article className="product-card" key={product.id} draggable onDragStart={(event) => { event.dataTransfer.setData(PRODUCT_DRAG_TYPE, product.id); event.dataTransfer.effectAllowed = 'copy'; setDragProduct(product.id); setActiveTool('select') }} onDragEnd={() => setDragProduct(null)}>
        <button type="button" className="product-card-button" onClick={() => addPoint ? addProduct(product.id, addPoint.x, addPoint.z, true) : addProduct(product.id)} title={`Add ${product.name} to room`}><ProductThumb product={product} />{placedCounts.get(product.id) ? <span className="placed-badge">{placedCounts.get(product.id)} in room</span> : null}<span className="product-card-body"><span className="product-card-info"><span>{product.category}</span><strong>{product.name}</strong><small>{product.width} × {product.depth} × {product.height} cm</small></span><span className="product-card-bottom"><strong>{formatPrice(product.price)}</strong><span className="add-product-button"><Icon name="plus" size={15} /></span></span></span></button>
      </article>)}</div>
      {filteredProducts.length === 0 && <div className="empty-search"><span>No products found</span><button className="text-button" onClick={() => { setSearch(''); setCategory('All'); setRetailer('All'); setSort('curated') }}>Clear filters</button></div>}
      <div className="own-item-card"><div><strong>Keeping something you own?</strong><span>Add a measured block so the plan reflects it. It never enters the basket.</span></div><button type="button" className="secondary-button" onClick={() => setCustomItemOpen(true)}><Icon name="plus" /> Add existing furniture</button></div>
    </div>
    <div className="panel-footer"><button type="button" className="primary-button wide" disabled={!project.objects.length} onClick={() => openStep('review')}>{project.objects.length ? 'Next: review & shop' : 'Place a piece to continue'} <Icon name="arrow" /></button></div>
  </>

  const panelContent = step === 'room' ? <RoomPanel project={project} floors={floors} activeTool={activeTool} onTool={chooseTool} onPatch={patchProject} onQuickRoom={createQuickRoom} onMeasure={() => setMeasureOpen(true)} onTemplates={() => setNewProjectOpen('living-room')} onImport={() => setImportOpen(true)} onNewProject={() => setNewProjectOpen('empty')} onNext={compact ? () => { setPanelOpen(false); setAddOpen(true) } : () => openStep('furnish')} onCollapse={collapsePanel} />
    : step === 'furnish' ? furnishPanel
      : <ReviewPanel project={project} total={estimatedTotal} basketCount={itemCount} warnings={warnings} onSelect={(id) => selectObject(id)} onToggle={toggleObjectBasket} onAddAll={addAllToBasket} onShopping={() => setShoppingOpen(true)} onExport={exportList} onRender={() => setRenderOpen(true)} onShare={shareProject} canRender={floors.length > 0} onCollapse={collapsePanel} />

  const projectTitle = <div className="project-title">
    <input aria-label="Project title" title="Rename project" value={projectName} maxLength={80} onChange={(event) => setProjectName(event.target.value)} onBlur={commitProjectName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setProjectName(project.name); requestAnimationFrame(() => (event.target as HTMLInputElement).blur()) } }} />
    <span className="save-indicator"><span className={`save-dot ${saveStatus === 'Unsaved changes' ? 'save-dot-dirty' : ''}`} />{saveStatus}</span>
  </div>
  const viewToggles = <>
    <span className="menu-heading">Display</span>
    <button role="switch" aria-checked={gridVisible} className="menu-toggle" onClick={() => setGridVisible(!gridVisible)}><Icon name="grid" /><span>Grid</span><span className={`toggle ${gridVisible ? 'toggle-on' : ''}`}><span /></span></button>
    <button role="switch" aria-checked={wallsTransparent} className="menu-toggle" onClick={() => setWallsTransparent(!wallsTransparent)}><Icon name="layers" /><span>Lower front walls in 3D</span><span className={`toggle ${wallsTransparent ? 'toggle-on' : ''}`}><span /></span></button>
    <label className="menu-select"><Icon name="sun" /><span>Lighting</span><select aria-label="Editor lighting mode" value={lightingMode} onChange={(event) => setLightingMode(event.target.value as LightingMode)}><option value="default">Default</option><option value="day">Day</option><option value="night">Night</option></select></label>
    <span className="menu-heading">Furniture snapping</span>
    <button role="switch" aria-checked={snap} className="menu-toggle" onClick={() => setSnap(!snap)}><Icon name="grid" /><span>Snap to 10 cm</span><span className={`toggle ${snap ? 'toggle-on' : ''}`}><span /></span></button>
    <button role="switch" aria-checked={wallSnap} className="menu-toggle" onClick={() => setWallSnap(!wallSnap)}><Icon name="wall" /><span>Snap against walls</span><span className={`toggle ${wallSnap ? 'toggle-on' : ''}`}><span /></span></button>
  </>
  const showWelcome = compact && !project.features.length && !welcomeDismissed
  const menuAction = (action: () => void) => () => { setMenuOpen(false); action() }
  const mobileMenu = <>
    <button type="button" className="m-backdrop" aria-label="Dismiss menu" onClick={() => setMenuOpen(false)} />
    <section className="m-menu" aria-label="Menu">
      <div className="m-menu-head">{projectTitle}<button type="button" className="add-sheet-icon" aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="close" size={20} /></button></div>
      <div className="m-menu-group">
        <button type="button" className="m-row" aria-label="Save project" disabled={cloudSaving} onClick={menuAction(saveProject)}><Icon name="save" size={20} /><span>{cloudSaving ? 'Saving…' : 'Save'}</span></button>
        <button type="button" className="m-row" aria-label="Shopping list" onClick={menuAction(() => setShoppingOpen(true))}><Icon name="shopping" size={20} /><span>Basket</span>{itemCount > 0 && <span className="action-count">{itemCount}</span>}</button>
        <button type="button" className="m-row" onClick={() => openMobilePanel('review')}><Icon name="check" size={20} /><span>Review &amp; shop</span></button>
        <button type="button" className="m-row" aria-label="Share project" onClick={menuAction(shareProject)}><Icon name="share" size={20} /><span>Share</span></button>
        <button type="button" className="m-row" aria-label="Render studio" disabled={!floors.length} onClick={menuAction(() => setRenderOpen(true))}><Icon name="image" size={20} /><span>Photo-style view</span></button>
      </div>
      <span className="menu-heading">Your home</span>
      <div className="m-menu-group">
        <button type="button" className="m-row" onClick={menuAction(() => setMeasureOpen(true))}><Icon name="wall" size={20} /><span>Measure a room</span></button>
        <button type="button" className="m-row" onClick={() => chooseTool('wall')}><Icon name="pointer" size={20} /><span>Draw walls</span></button>
        <button type="button" className="m-row" onClick={() => openMobilePanel('room')}><Icon name="sliders" size={20} /><span>Room size &amp; finishes</span></button>
        <button type="button" className="m-row" onClick={menuAction(() => setImportOpen(true))}><Icon name="upload" size={20} /><span>Import a floor plan</span></button>
        <button type="button" className="m-row" onClick={menuAction(() => setNewProjectOpen('living-room'))}><Icon name="home" size={20} /><span>Example rooms</span></button>
        <button type="button" className="m-row" onClick={menuAction(() => setNewProjectOpen('empty'))}><Icon name="plus" size={20} /><span>Start a new plan</span></button>
      </div>
      <div className="m-menu-group m-menu-view">{viewToggles}</div>
      <a className="m-row m-profile" href="/profile" aria-label="Open profile"><Icon name="user" size={20} /><span>{accountUser?.email || 'Sign in · my saved designs'}</span></a>
    </section>
  </>
  const welcome = <section className="m-welcome" aria-label="Start your plan" inert={modalOpen}>
    <div className="m-welcome-brand"><span className="brand-mark"><span /><span /><span /><span /></span><strong>FORMIVO</strong></div>
    <h1>Let’s draw your home</h1>
    <p>Start with one room. Doors, windows and furniture come next, and you can change everything later.</p>
    <div className="m-welcome-options">
      <button type="button" className="m-option m-option-primary" onClick={() => setMeasureOpen(true)}><Icon name="wall" size={26} /><span><strong>Measure my room</strong><small>Walk along each wall with your phone or a tape measure</small></span></button>
      <button type="button" className="m-option" onClick={() => chooseTool('sketch')}><Icon name="pointer" size={26} /><span><strong>Sketch it with your finger</strong><small>Draw the outline roughly; we straighten it into walls</small></span></button>
      <button type="button" className="m-option" onClick={() => chooseTool('wall')}><Icon name="wall" size={26} /><span><strong>Draw it on screen</strong><small>Drag along a grid to place each wall exactly</small></span></button>
      <button type="button" className="m-option" onClick={() => openMobilePanel('room')}><Icon name="grid" size={26} /><span><strong>Enter a room size</strong><small>Type the width and length of a simple room</small></span></button>
      <button type="button" className="m-option" onClick={() => setNewProjectOpen('living-room')}><Icon name="home" size={26} /><span><strong>Use an example room</strong><small>Start from a ready-made living room</small></span></button>
    </div>
    <div className="m-welcome-links"><button type="button" className="text-button" onClick={() => setImportOpen(true)}>Import a floor plan</button><a className="text-button" href="/profile">My saved designs</a></div>
  </section>
  const drawingHint = activeTool === 'wall' ? 'Drag your finger along the grid to draw a wall. Two fingers move the view.'
    : activeTool === 'room' ? 'Drag a box to add a room with four walls.'
    : activeTool === 'erase' ? 'Drag along a wall to remove part of it, or tap a wall to remove it.'
    : `Tap a wall to place the ${activeTool}.`
  const sketchBar = <div className="m-drawbar m-drawbar-stack" role="toolbar" aria-label="Sketch">
    <span>{sketchStrokes.length ? 'Keep drawing, or make the walls when the outline is done.' : 'Draw the outline of your room with your finger. Lift and keep going any time.'}</span>
    <div className="m-drawbar-actions"><button type="button" className="secondary-button" onClick={() => sketchStrokes.length ? setSketchStrokes([]) : chooseTool('select')}>{sketchStrokes.length ? 'Clear' : 'Cancel'}</button><button type="button" className="primary-button" disabled={!sketchStrokes.length} onClick={finishSketch}>Make walls</button></div>
  </div>

  return (
    <div className={`app-shell ${compact ? 'app-compact' : panelOpen ? 'panel-open' : ''}`}>
      {!compact && <header className="topbar" inert={renderOpen || modalOpen}>
        <div className="topbar-left">
          <a className="brand" href="/" aria-label="Formivo home"><span className="brand-mark"><span /><span /><span /><span /></span><strong>FORMIVO</strong></a>
          {projectTitle}
        </div>
        {stepNav('step-nav')}
        <div className="top-actions">
          <div className="history-buttons"><button className="top-icon-button" title="Undo" aria-label="Undo" disabled={!history.current.past.length} onClick={undo}><Icon name="undo" size={18} /></button><button className="top-icon-button" title="Redo" aria-label="Redo" disabled={!history.current.future.length} onClick={redo}><Icon name="redo" size={18} /></button></div>
          <button className="top-action-button share-button" aria-label="Share project" title="Copy a share link" onClick={shareProject}><Icon name="share" /><span>Share</span></button>
          <button className="top-action-button basket-button" aria-label="Shopping list" title="Shopping list" onClick={() => setShoppingOpen(true)}><Icon name="shopping" /><span>Basket</span>{itemCount > 0 && <span className="action-count">{itemCount}</span>}</button>
          <button className="top-action-button primary-top-action" aria-label="Save project" title="Save (⌘S)" onClick={saveProject} disabled={cloudSaving}><Icon name="save" /><span>{cloudSaving ? 'Saving…' : 'Save'}</span></button>
          <a className="avatar" href="/profile" title={accountUser?.email || 'Sign in or open your profile'} aria-label="Open profile">{accountUser?.email?.[0]?.toUpperCase() || <Icon name="user" size={16} />}</a>
        </div>
      </header>}

      <div className={`editor-layout ${panelOpen && !compact ? '' : 'panel-collapsed'}`} inert={renderOpen || modalOpen || showWelcome}>
        {!compact && <aside className="side-panel" aria-label={`${steps.find((item) => item.id === step)!.label} panel`} inert={!panelOpen}>{panelContent}</aside>}

        <main className="workspace">
          <div className={`canvas-frame ${dragProduct ? 'drop-active' : ''}`} data-drag-product={dragProduct || ''} data-room-count={floors.length} data-floor-area={floorArea.toFixed(2)} data-wall-count={wallCount}>
            <RoomScene project={project} viewMode={viewMode} gridVisible={gridVisible} wallsTransparent={wallsTransparent} selectedIds={selectedIds} selectedFeatureId={selectedFeatureId} activeTool={activeTool} draggingId={draggingId} cameraVersion={cameraVersion} onClearSelection={tapEmptyCanvas} onSelectObject={selectObject} onSelectFeature={tapFeature} onPlaceFeature={addFeature} onMoveObject={moveObject} onDragStart={(id) => { dragSnapshot.current = projectRef.current; setDraggingId(id) }} onDragEnd={endDrag} onDragCancel={cancelDrag} addPoint={addPoint} onAddAt={addAt} snap={snap} wallSnap={wallSnap} lightingMode={lightingMode} onDropProduct={addProduct} onBuild={buildAction} sketch={sketchStrokes} onErase={eraseFeature} onEditLength={setLengthWallId} onMoveEndpoint={(id, previous, next) => setProject((current) => moveWallEndpoint(current, id, previous, next))} onMoveOpening={moveOpening} />
            <div className="canvas-label">{viewMode === '3d' ? '3D view' : 'Floor plan'} · {activeTool === 'wall' ? 'Build grid · 25 cm' : 'Real dimensions · metres'}</div>
          </div>

          {!compact && <>
            {!panelOpen && <button className="show-panel-button" onClick={() => setPanelOpen(true)} aria-label="Show panel" title="Show panel"><Icon name="panel" /></button>}
            <div className={`canvas-toolbar ${activeTool !== 'select' ? 'toolbar-drawing' : ''}`} role="toolbar" aria-label="Drawing tools">
              {tools.map(([tool, label, icon, key]) => <button key={tool} className={`tool-button ${activeTool === tool ? 'tool-button-active' : ''}`} aria-pressed={activeTool === tool} title={`${label} (${key})`} onClick={() => chooseTool(tool)}><Icon name={icon} size={18} /><span>{label}</span></button>)}
              <span className="toolbar-divider" />
              <div className="view-switcher" role="group" aria-label="View mode"><button className={viewMode === '2d' ? 'view-active' : ''} aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>2D</button><button className={viewMode === '3d' ? 'view-active' : ''} aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>3D</button></div>
              {activeTool !== 'select' && <button type="button" className="tool-done" title="Finish (Esc)" onClick={() => chooseTool('select')}><Icon name="check" size={15} /><span>Done</span></button>}
            </div>
            <div className="canvas-actions">
              <button className="render-launch" aria-label="Render studio" title={floors.length ? 'Open a photo-style render of your room' : 'Close a room to render it'} disabled={!floors.length} onClick={() => setRenderOpen(true)}><Icon name="image" /><span>Render studio</span></button>
              <div className="view-menu-wrap">
                <button className={`canvas-icon-button ${viewMenuOpen ? 'canvas-icon-button-active' : ''}`} aria-label="View options" title="View options" aria-expanded={viewMenuOpen} onClick={() => setViewMenuOpen(!viewMenuOpen)}><Icon name="sliders" /></button>
                {viewMenuOpen && <div className="view-menu" role="group" aria-label="View settings">{viewToggles}</div>}
              </div>
              <button className="canvas-icon-button" aria-label="Reset camera" title="Recentre the view" onClick={() => setCameraVersion((value) => value + 1)}><Icon name="focus" /></button>
            </div>
            {!project.features.length && !dragProduct && <div className="empty-build-hint">
              <span className="empty-icon"><Icon name="wall" size={22} /></span>
              <strong>Your space starts here</strong>
              <span>Click to place your first corner, then each next corner. Close the outline to create the floor — or enter a size in the panel.</span>
              <div className="quick-start-actions"><button type="button" className="secondary-button" onClick={() => setMeasureOpen(true)}><Icon name="wall" /> Measure my room</button><button type="button" className="secondary-button" onClick={() => chooseTool('sketch')}><Icon name="pointer" /> Sketch the outline</button><button type="button" className="secondary-button empty-import-button" onClick={() => setImportOpen(true)}><Icon name="upload" /> Import floor plan</button><button type="button" className="secondary-button empty-import-button" onClick={() => setNewProjectOpen('living-room')}><Icon name="home" /> Use a room template</button></div>
            </div>}
            <div className="canvas-tip">{canvasTip}</div>
            {hasSelection && <aside className="inspector-card" aria-label="Selection details">{inspectorContent}{selectedObject && selectionWarnings.length > 0 && <section className="inspector-section"><div className="section-label-row"><span>Placement checks</span></div>{selectionWarnings.map((warning, index) => <div className="health-row warning" key={index}><span className="health-dot" />{warning.message}</div>)}</section>}</aside>}
          </>}
          {!compact && activeTool === 'sketch' && sketchBar}
          {dragProduct && <div className="drop-prompt">{floors.length ? 'Drop inside your room' : 'Close your walls before furnishing'}</div>}
        </main>
      </div>

      {compact && !renderOpen && <>
        {showWelcome ? welcome : <div className="m-chrome" inert={modalOpen}>
          <div className="m-top">
            <button type="button" className="m-round m-menu-button" aria-label="Menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(!menuOpen); setAddOpen(false); setPanelOpen(false); setDetailsOpen(false) }}><Icon name="menu" size={22} />{itemCount > 0 && <span className="action-count">{itemCount}</span>}</button>
            <div className="m-top-actions">
              <button type="button" className="m-round" aria-label="Reset camera" title="Recentre the view" onClick={() => setCameraVersion((value) => value + 1)}><Icon name="focus" size={20} /></button>
              {history.current.future.length > 0 && <button type="button" className="m-round" title="Redo" aria-label="Redo" onClick={redo}><Icon name="redo" size={20} /></button>}
              <button type="button" className="m-round" title="Undo" aria-label="Undo" disabled={!history.current.past.length} onClick={undo}><Icon name="undo" size={20} /></button>
            </div>
          </div>
          {hangItem ? <div className="m-drawbar" role="toolbar" aria-label="Hang on a wall"><span>Tap the wall where the {roomItemShape(hangItem)?.name || 'item'} should go.</span><button type="button" className="primary-button" onClick={() => setHangItem(null)}>Cancel</button></div>
            : activeTool === 'sketch' ? sketchBar
            : activeTool !== 'select' ? <div className="m-drawbar m-drawbar-stack" role="toolbar" aria-label="Drawing tools"><span>{drawingHint}</span>
              <div className="m-drawbar-actions">
                {BUILD_TOOLS.includes(activeTool) && <div className="m-build-tools" role="group" aria-label="Wall tools">{(['wall', 'room', 'erase'] as Tool[]).map((tool) => <button key={tool} type="button" aria-pressed={activeTool === tool} onClick={() => chooseTool(tool)}>{tool === 'wall' ? 'Wall' : tool === 'room' ? 'Room' : 'Erase'}</button>)}</div>}
                <button type="button" className="primary-button" onClick={() => chooseTool('select')}>Done</button>
              </div></div>
            : hasSelection ? !panelOpen && !detailsOpen && <div className="selection-dock"><div className="dock-bar">{selectionActions}<button className="dock-details" aria-label="Open detailed inspector" title="Details" onClick={() => setDetailsOpen(true)}><Icon name="sliders" /><span>Details</span></button></div></div>
              : !addOpen && !panelOpen && !menuOpen && <div className="m-bottom">
                <div className="m-view" role="group" aria-label="View mode"><button type="button" aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>Plan</button><button type="button" aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>3D</button></div>
                <button type="button" className="m-add" onClick={() => openAddSheet()}><Icon name="plus" size={22} /><span>Add furniture</span></button>
              </div>}
        </div>}
        {(panelOpen || (detailsOpen && hasSelection)) && <section className="mobile-sheet" aria-label={detailsOpen && hasSelection ? 'Selection details' : `${steps.find((item) => item.id === step)!.label} panel`} inert={modalOpen}>
          <button type="button" className="sheet-handle" aria-label="Close panel" onClick={() => { setPanelOpen(false); setDetailsOpen(false) }}><span /></button>
          {detailsOpen && hasSelection ? <div className="panel-scroll">{inspectorContent}</div> : panelContent}
        </section>}
        {addOpen && <AddItemSheet initialRoom={targetWallId ? 'wall' : undefined} products={products} placedCounts={placedCounts} onAdd={(id) => addPoint ? addProduct(id, addPoint.x, addPoint.z, true) : addProduct(id)} onOwnItem={() => { setAddOpen(false); setCustomItemOpen(true) }} onClose={() => setAddOpen(false)} />}
        {menuOpen && mobileMenu}
      </>}
      {renderOpen && <Suspense fallback={<div className="render-loading" role="status">Loading render studio… <button onClick={() => setRenderOpen(false)}>Back to editor</button></div>}><RenderStudio project={project} onClose={() => setRenderOpen(false)} /></Suspense>}
      {!renderOpen && !importOpen && !customItemOpen && !measureOpen && !menuOpen && notice && <div className={`toast ${!project.features.length ? 'toast-high' : ''}`} role="status">{notice}</div>}
      {shoppingOpen && <ShoppingDrawer items={shoppingItems} total={estimatedTotal} onClose={() => setShoppingOpen(false)} onExport={exportList} onRequest={() => { setShoppingOpen(false); if (!accountUser) { window.location.assign(`/profile?returnTo=${encodeURIComponent('/planner')}`); return } setRequestOpen(true) }} />}
      {newProjectOpen && <NewProjectModal initialTemplate={newProjectOpen} onClose={() => setNewProjectOpen(null)} onCreate={createProject} />}
      {requestOpen && <PurchaseRequestModal total={estimatedTotal} onClose={() => setRequestOpen(false)} onSubmit={submitPurchaseRequest} />}
      {customItemOpen && <ExistingItemModal onClose={() => setCustomItemOpen(false)} onCreate={addCustomObject} />}
      {importOpen && <PlanImportModal onClose={() => setImportOpen(false)} onImport={importProject} />}
      {twistLabel && <div className="twist-label" style={{ left: twistLabel.x, top: twistLabel.y }} aria-hidden="true">{twistLabel.degrees}°</div>}
      {lengthWallId && <WallLengthDialog wall={project.features.find((feature) => feature.id === lengthWallId)} onClose={() => setLengthWallId(null)} onSet={(length) => { const next = setWallLength(projectRef.current, lengthWallId, length); if (next === projectRef.current) setNotice('That length would squeeze a neighbouring wall too short.'); else setProject(next); setLengthWallId(null) }} />}
      {measureOpen && <MeasureRoom name={project.name} ceilingHeight={project.ceilingHeight} replacing={project.features.length > 0 || project.objects.length > 0} onClose={() => setMeasureOpen(false)} onBuild={buildMeasuredRoom} />}
    </div>
  )
}

export default App
