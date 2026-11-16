import { Box3, Group, Mesh, SRGBColorSpace, Texture, Vector3 } from 'three'

export function productMaterialNames(scene: Group) {
  const names = new Set<string>()
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.material) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.name.trim()) names.add(material.name)
    }
  })
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function cloneProductScene(scene: Group, tone: string, texture?: Texture, materialName?: string | null, fit = false) {
  const clone = scene.clone(true)
  clone.traverse((object) => {
    object.castShadow = true
    object.receiveShadow = true
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const materials = sourceMaterials.map((source) => {
      const material = source.clone() as typeof source & { map?: Texture; color?: { set: (value: string) => void } }
      const matches = materialName?.trim()
        ? material.name.toLowerCase() === materialName.trim().toLowerCase()
        : /upholstery|cushion|fabric/i.test(material.name)
      if (texture && matches) {
        texture.colorSpace = SRGBColorSpace
        texture.flipY = false
        texture.needsUpdate = true
        material.map = texture
        material.color?.set('#ffffff')
        material.needsUpdate = true
      } else if (material.color && /upholstery|cushion|fabric/i.test(material.name)) material.color.set(tone)
      return material
    })
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
  })
  if (fit) {
    const box = new Box3().setFromObject(clone), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3())
    const scale = 2.2 / Math.max(size.x, size.y, size.z, 0.01)
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
    clone.scale.setScalar(scale)
  }
  return clone
}
