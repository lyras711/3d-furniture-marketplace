import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, OrbitControls, useTexture } from '@react-three/drei'
import { ACESFilmicToneMapping } from 'three'
import { WebGLPathTracer, DenoiseMaterial } from 'three-gpu-pathtracer'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { ProductModel } from './App'
import { products } from './catalog'
import SurfaceMaterial, { surfaceUrls } from './SurfaceMaterial'

export const showcasePositions: Record<string, [number, number, number]> = {
  'sofa-haven': [0, 0, -1.25], 'table-arc': [0, 0, 0.25], 'rug-loom': [0, 0, 0.15],
  'lamp-halo': [1.65, 0, -1.35], 'plant-olive': [-1.85, 0, -1.35],
}

function Box({ at, size, color = '#ded6c5' }: { at: [number, number, number]; size: [number, number, number]; color?: string }) {
  return <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.92} /></mesh>
}

function Scene({ selected, built, product }: { selected: string[]; built: boolean; product?: string }) {
  return <>
    <color attach="background" args={['#e8e4d9']} />
    <Environment files="/materials/forest.hdr" environmentIntensity={0.45} />
    <ambientLight intensity={0.2} />
    <directionalLight position={[-3, 6, 3]} intensity={4} color="#fff0d7" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-normalBias={0.01} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} receiveShadow><planeGeometry args={[200, 200]} /><meshStandardMaterial color="#ded8c9" roughness={0.85} /></mesh>
    {product ? <ProductModel product={products.find((p) => p.id === product)!} /> : <>
      {built ? <>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow><planeGeometry args={[6, 5]} /><SurfaceMaterial kind="floor" color="#e6cfaa" /></mesh>
        <Box at={[0, 1.6, -2]} size={[6, 3.2, 0.16]} />
        <Box at={[-2.9, 1.6, -1.1]} size={[0.16, 3.2, 1.8]} />
        <Box at={[-2.9, 3, 0.9]} size={[0.16, 0.4, 2.2]} />
        <Box at={[-2.9, 1.6, 2]} size={[0.16, 3.2, 0.2]} />
        <Box at={[-2.9, 0.18, 0.95]} size={[0.16, 0.36, 2]} />
        <Box at={[-2.9, 1.65, 0.85]} size={[0.18, 2.6, 0.06]} color="#716b55" />
        <Box at={[-2.9, 1.45, 0.95]} size={[0.18, 0.06, 2]} color="#716b55" />
        <Box at={[0.05, 1.98, -1.89]} size={[1.34, 1.65, 0.04]} color="#6d523e" />
        <Box at={[0.05, 1.98, -1.86]} size={[1.26, 1.57, 0.025]} color="#eee6d7" />
        <mesh position={[0.05, 2.09, -1.837]}><circleGeometry args={[0.46, 64]} /><meshStandardMaterial color="#8d4934" roughness={1} /></mesh>
        <Box at={[0.05, 1.66, -1.81]} size={[0.92, 0.12, 0.012]} color="#eee6d7" />
        <Box at={[0, 0.055, -1.895]} size={[6, 0.11, 0.045]} color="#ece5d7" />
      </> : <gridHelper args={[6, 24, '#adae9b', '#cecec0']} />}
      {selected.map((id) => <group key={id} position={showcasePositions[id]}><ProductModel product={products.find((p) => p.id === id)!} /></group>)}
    </>}
  </>
}

function AssetRender({ product }: { product?: string }) {
  const { gl, scene, camera } = useThree()
  const tracer = useRef<WebGLPathTracer | null>(null)
  const denoise = useRef<FullScreenQuad | null>(null)
  useTexture([...surfaceUrls('oak'), ...surfaceUrls('linen'), ...surfaceUrls('floor')])
  useEffect(() => {
    camera.position.set(...(product ? [2.5, 1.6, 3.4] : [2.8, 1.7, 4]) as [number, number, number])
    camera.lookAt(0, product === 'lamp-halo' ? 0.75 : product ? 0.4 : 1.05, product ? 0 : -1.1)
    camera.updateMatrixWorld()
    const pt = new WebGLPathTracer(gl)
    pt.bounces = 5
    pt.tiles.set(2, 2)
    pt.minSamples = 1
    pt.renderToCanvas = false
    pt.setScene(scene, camera)
    tracer.current = pt
    denoise.current = new FullScreenQuad(new DenoiseMaterial({ sigma: 2, kSigma: 2, threshold: 0.12 }))
    return () => { pt.dispose(); denoise.current?.material.dispose(); denoise.current?.dispose() }
  }, [camera, gl, scene, product])
  useFrame(() => {
    const pt = tracer.current
    if (!pt || !denoise.current) return
    if (pt.samples < 384) pt.renderSample()
    if (pt.samples >= 1) {
      ;(denoise.current.material as DenoiseMaterial).map = pt.target.texture
      denoise.current.render(gl)
    } else gl.render(scene, camera)
    gl.domElement.dataset.samples = String(Math.floor(pt.samples))
  }, 1)
  return null
}

export default function ShowcaseScene({ selected = Object.keys(showcasePositions), built = true, art = false, product }: { selected?: string[]; built?: boolean; art?: boolean; product?: string }) {
  const [supported] = useState(() => {
    try {
      const context = document.createElement('canvas').getContext('webgl2')
      context?.getExtension('WEBGL_lose_context')?.loseContext()
      return Boolean(context)
    } catch { return false }
  })
  if (!supported) throw new Error('WebGL2 unavailable')
  return <Canvas role="img" aria-label="Interactive 3D room preview" shadows dpr={art ? 1 : [1, 1.5]} frameloop={art ? 'always' : 'demand'} camera={{ position: [5, 4.3, 7], fov: product ? 35 : 42 }} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, preserveDrawingBuffer: art }}>
    {!art && <OrbitControls makeDefault target={[0, 0.65, -0.2]} enablePan={false} minDistance={5} maxDistance={12} maxPolarAngle={Math.PI / 2.05} />}
    <Suspense fallback={null}>
      <Scene selected={selected} built={built} product={product} />
      {art && <AssetRender product={product} />}
    </Suspense>
  </Canvas>
}
