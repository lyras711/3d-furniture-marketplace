import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, OrbitControls, useTexture } from '@react-three/drei'
import { ACESFilmicToneMapping, Matrix4, Vector3 } from 'three'
import { DenoiseMaterial, WebGLPathTracer } from 'three-gpu-pathtracer'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { Architecture, FloorSurface } from './SceneEnvironment'
import { ProductModel } from './App'
import { surfaceUrls } from './SurfaceMaterial'
import { floorColors, getFloorRegions, pointInPolygon, productById, wallThickness, type FloorRegion, type ProjectState } from './editor'

const noop = () => {}

class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="render-failure" role="alert">The render could not load. Check WebGL support and reload to retry. Your project is unchanged.</div> : this.props.children }
}

function cameraPoints(region: FloorRegion, corner: number) {
  const xs = region.points.map((p) => p.x), zs = region.points.map((p) => p.z)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const points = Array.from({ length: 625 }, (_, i) => ({ x: minX + (i % 25 + 0.5) / 25 * (maxX - minX), z: minZ + (Math.floor(i / 25) + 0.5) / 25 * (maxZ - minZ) })).filter((p) => {
    const inside = (x: number, z: number) => pointInPolygon({ x, z }, region.points) && !region.holes.some((h) => pointInPolygon({ x, z }, h))
    return [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]].every(([dx, dz]) => inside(p.x + dx, p.z + dz))
  })
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const tx = corner % 2 ? minX : maxX, tz = corner < 2 ? maxZ : minZ
  const nearest = (x: number, z: number) => [...points].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] || region.points[0]
  return { eye: nearest(tx, tz), target: nearest(cx, cz) }
}

function InteriorCamera({ region, corner, height }: { region: FloorRegion; corner: number; height: number }) {
  const { camera, controls, invalidate } = useThree()
  useEffect(() => {
    const { eye, target } = cameraPoints(region, corner)
    const orbit = controls as unknown as { target: Vector3; update: () => void } | null
    camera.position.set(eye.x, Math.min(1.55, height - 0.2), eye.z)
    orbit?.target.set(target.x, Math.min(1.2, height * 0.5), target.z)
    camera.lookAt(target.x, Math.min(1.2, height * 0.5), target.z)
    orbit?.update()
    invalidate()
  }, [camera, controls, region, corner, height, invalidate])
  return null
}

function RenderLoop({ traced, exposure, ceiling, exportVersion, onStatus, onReady }: {
  traced: boolean; exposure: number; ceiling: boolean; exportVersion: number
  onStatus: (status: string) => void; onReady: (ready: boolean) => void
}) {
  const { gl, scene, camera, invalidate, size } = useThree()
  const tracer = useRef<WebGLPathTracer | null>(null)
  const denoiser = useRef<FullScreenQuad | null>(null)
  const failed = useRef(false)
  const view = useRef(new Matrix4())
  const projection = useRef(new Matrix4())
  const exported = useRef(exportVersion)
  const reported = useRef(-1)
  useTexture(surfaceUrls('oak'))
  useTexture(surfaceUrls('linen'))
  useTexture(surfaceUrls('floor'))
  useEffect(() => {
    failed.current = false
    reported.current = -1
    onReady(false)
    if (traced) {
      onStatus('Preparing light transport…')
      try {
        if (!gl.extensions.has('EXT_color_buffer_float')) throw new Error('Float targets unavailable')
        const next = new WebGLPathTracer(gl)
        tracer.current = next
        next.bounces = 8
        next.transmissiveBounces = 8
        next.filterGlossyFactor = 0.5
        next.tiles.set(3, 3)
        next.textureSize.set(1024, 1024)
        next.renderScale = Math.min(1, 1400 / (size.width * gl.getPixelRatio()))
        next.minSamples = 1
        next.fadeDuration = 250
        next.renderToCanvas = false
        denoiser.current = new FullScreenQuad(new DenoiseMaterial({ sigma: 2, kSigma: 2, threshold: 0.15 }))
        next.setScene(scene, camera)
      } catch {
        failed.current = true
        tracer.current?.dispose()
        tracer.current = null
        onStatus('Path tracing unavailable on this GPU · showing live preview')
      }
    } else onStatus('Live preview · select Path traced for final lighting')
    invalidate()
    return () => {
      tracer.current?.dispose(); tracer.current = null
      denoiser.current?.material.dispose(); denoiser.current?.dispose(); denoiser.current = null
    }
  }, [traced, scene, camera, gl, invalidate, onReady, onStatus])
  useEffect(() => { gl.toneMappingExposure = exposure; invalidate() }, [gl, exposure, invalidate])
  useEffect(() => {
    if (tracer.current) {
      tracer.current.renderScale = Math.min(1, 1400 / (size.width * gl.getPixelRatio()))
      tracer.current.setScene(scene, camera)
      reported.current = -1
    }
    invalidate()
  }, [ceiling, scene, camera, gl, size.width, size.height, invalidate])
  useEffect(() => {
    const lost = () => { onReady(false); onStatus('GPU context lost. Close the studio and reopen it to retry.') }
    gl.domElement.addEventListener('webglcontextlost', lost)
    return () => gl.domElement.removeEventListener('webglcontextlost', lost)
  }, [gl, onReady, onStatus])
  useFrame(() => {
    if (gl.getContext().isContextLost()) return
    const pt = tracer.current
    camera.updateMatrixWorld()
    if (pt && (!view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix))) {
      view.current.copy(camera.matrixWorld)
      projection.current.copy(camera.projectionMatrix)
      pt.updateCamera()
      reported.current = -1
    }
    try {
      if (pt) {
        pt.pausePathTracing = pt.samples >= 256
        pt.renderSample()
      }
      if (pt && pt.samples >= 1 && denoiser.current) {
        ;(denoiser.current.material as DenoiseMaterial).map = pt.target.texture
        denoiser.current.render(gl)
      } else gl.render(scene, camera)
    } catch {
      tracer.current?.dispose()
      tracer.current = null
      failed.current = true
      onStatus('Path tracing failed on this GPU · showing live preview')
      invalidate()
      return
    }
    gl.domElement.dataset.renderReady = 'true'
    onReady(true)
    if (pt) {
      const samples = Math.floor(pt.samples)
      gl.domElement.dataset.samples = String(samples)
      if (samples !== reported.current && (samples < 2 || samples % 8 === 0)) {
        reported.current = samples
        onStatus(samples >= 256 ? '256 samples · render complete' : `${samples} / 256 samples · hold the camera still to refine`)
      }
      if (pt.samples < 256) invalidate()
    } else if (!failed.current) gl.domElement.dataset.samples = '0'
    if (exported.current !== exportVersion) {
      exported.current = exportVersion
      gl.domElement.toBlob((blob) => {
        if (!blob) { onStatus('PNG export failed. Try again.'); return }
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url; link.download = 'formivo-interior.png'; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    }
  }, 1)
  return null
}

function Interior({ project, ceiling }: { project: ProjectState; ceiling: boolean }) {
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  return <>
    <Environment files="/materials/forest.hdr" background environmentIntensity={0.65} backgroundIntensity={0.8} environmentRotation={[0, 1.1, 0]} backgroundRotation={[0, 1.1, 0]} />
    <ambientLight intensity={0.12} />
    <directionalLight position={[-4, 8, -6]} intensity={2.8} color="#fff1db" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-normalBias={0.012} />
    {regions.map((region) => <group key={region.id}>
      <FloorSurface region={region} color={floorColors[project.floorMaterial]} finish={project.floorMaterial} />
      {ceiling && <FloorSurface region={region} color="#eee9df" elevation={project.ceilingHeight} ceiling />}
    </group>)}
    <Architecture project={project} viewMode="3d" cutaway={false} selectedId={null} tool="render" onSelect={noop} onPlace={noop} onMoveEndpoint={noop} onMoveOpening={noop} onDragStart={noop} onDragEnd={noop} />
    {project.features.filter((f) => f.type === 'window').map((f) => {
      const nx = Math.sin(f.rotation), nz = Math.cos(f.rotation)
      const parent = project.features.find((wall) => wall.id === f.wallId), offset = (parent ? wallThickness(parent) : 0.12) / 2 + 0.03
      const inside = regions.some((r) => pointInPolygon({ x: f.x + nx * 0.2, z: f.z + nz * 0.2 }, r.points)) ? 1 : -1
      return <rectAreaLight key={f.id} position={[f.x + nx * inside * offset, (f.sillHeight || 0) + f.height / 2, f.z + nz * inside * offset]} rotation={[0, f.rotation + (inside === 1 ? Math.PI : 0), 0]} width={f.width * 0.9} height={f.height * 0.9} intensity={5} color="#ffedcf" />
    })}
    {project.objects.map((o) => <group key={o.id} position={[o.x, 0, o.z]} rotation={[0, o.rotation, 0]}><ProductModel product={productById.get(o.productId)!} variantId={o.variantId} /></group>)}
  </>
}

export default function RenderStudio({ project, onClose }: { project: ProjectState; onClose: () => void }) {
  const [traced, setTraced] = useState(false)
  const [exposure, setExposure] = useState(1.15)
  const [ceiling, setCeiling] = useState(true)
  const [room, setRoom] = useState(0)
  const [corner, setCorner] = useState(0)
  const [exportVersion, setExportVersion] = useState(0)
  const [status, setStatus] = useState('Loading local materials and daylight…')
  const [ready, setReady] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const regions = useMemo(() => getFloorRegions(project.features), [project.features])
  const report = useCallback((message: string) => setStatus(message), [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select') || [])
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    root.current?.addEventListener('keydown', keys)
    const node = root.current
    return () => { node?.removeEventListener('keydown', keys); previous?.focus() }
  }, [onClose])
  return <div ref={root} className="render-studio" role="dialog" aria-modal="true" aria-label="Render studio">
    <header className="render-header"><button onClick={onClose}>Back to editor</button><div><span className="eyebrow">FORMIVO / INTERIORS</span><strong>Render studio</strong></div><button onClick={() => setExportVersion((v) => v + 1)} disabled={!ready}>Save PNG</button></header>
    <div className="render-viewport">
      <RenderBoundary><Canvas shadows frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 60, near: 0.03, far: 160 }} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping }}>
        <OrbitControls makeDefault enableDamping={false} minDistance={0.2} maxDistance={40} maxPolarAngle={Math.PI * 0.85} />
        <InteriorCamera region={regions[room]} corner={corner} height={project.ceilingHeight} />
        <Suspense fallback={null}>
          <Interior project={project} ceiling={ceiling} />
          <RenderLoop traced={traced} exposure={exposure} ceiling={ceiling} exportVersion={exportVersion} onStatus={report} onReady={setReady} />
        </Suspense>
      </Canvas></RenderBoundary>
      <div className="render-caption"><span>INTERIOR PERSPECTIVE</span><strong>{project.name}</strong><small>Sample geometry · not retailer-accurate models</small></div>
      {!project.features.some((f) => f.type === 'window') && <div className="render-light-hint">No windows in this room layout. Add windows in the editor for natural interior light, or turn the ceiling off for a studio study.</div>}
      <div className="render-progress" role="status">{status}</div>
    </div>
    <footer className="render-controls">
      <div className="render-mode"><button aria-pressed={!traced} onClick={() => setTraced(false)}>Live preview</button><button aria-pressed={traced} onClick={() => setTraced(true)}>Path traced</button></div>
      <label>Room<select aria-label="Render room" value={room} onChange={(e) => setRoom(Number(e.target.value))}>{regions.map((r, i) => <option key={r.id} value={i}>Room {i + 1} · {r.area.toFixed(1)} m²</option>)}</select></label>
      <label>Camera<select aria-label="Camera position" value={corner} onChange={(e) => setCorner(Number(e.target.value))}>{['South east', 'South west', 'North east', 'North west'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      <label>Exposure<input aria-label="Exposure" type="range" min="0.4" max="3" step="0.05" value={exposure} onChange={(e) => setExposure(Number(e.target.value))} /></label>
      <label className="render-ceiling"><input type="checkbox" checked={ceiling} onChange={(e) => setCeiling(e.target.checked)} /> Ceiling</label>
      <span className="render-help">Drag to orbit · right-drag to pan · scroll to dolly<br />Local CC0 surfaces & daylight / Poly Haven</span>
    </footer>
  </div>
}
