import { Suspense, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { RepeatWrapping, SRGBColorSpace } from 'three'

export const surfaceUrls = (kind: 'oak' | 'linen' | 'floor') => ['color', 'normal', 'roughness'].map((map) => `/materials/${kind}-${map}.jpg`)

type SurfaceProps = { kind: 'oak' | 'linen' | 'floor'; color?: string }

export default function SurfaceMaterial(props: SurfaceProps) {
  return <Suspense fallback={<meshPhysicalMaterial color={props.color || '#ffffff'} roughness={0.85} />}><TexturedSurface {...props} /></Suspense>
}

function TexturedSurface({ kind, color = '#ffffff' }: SurfaceProps) {
  const textures = useTexture(surfaceUrls(kind))
  const [map, normalMap, roughnessMap] = useMemo(() => {
    textures.forEach((texture, index) => {
      texture.wrapS = texture.wrapT = RepeatWrapping
      texture.repeat.setScalar(kind === 'linen' ? 4 : 1)
      texture.anisotropy = 8
      if (index === 0) texture.colorSpace = SRGBColorSpace
      texture.needsUpdate = true
    })
    return textures
  }, [textures, kind])
  return <meshPhysicalMaterial color={color} map={kind === 'linen' ? undefined : map} normalMap={normalMap} roughnessMap={roughnessMap} normalScale={kind === 'linen' ? [0.35, 0.35] : [0.3, 0.3]} roughness={kind === 'linen' ? 1 : 0.65} sheen={kind === 'linen' ? 0.6 : 0} sheenColor={color} sheenRoughness={0.85} />
}
