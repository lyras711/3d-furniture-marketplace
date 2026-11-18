import { Component, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, useTexture } from '@react-three/drei'
import type { Group, Texture } from 'three'
import { catalogGroups, type CatalogGroup, type ProductVariant } from '../catalog'
import { cloneProductScene, productMaterialNames } from '../productScene'
import { atLeast, errorText, euro, send, type CatalogItem } from './api'

type TextureDraft = { file: File; url: string; materialName: string }
type CatalogDraft = { name: string; brand: string; retailer: string; sku: string; group: CatalogGroup; category: string; width: string; depth: string; height: string; price: string }

function catalogDraft(product: CatalogItem): CatalogDraft {
  return { name: product.name, brand: product.brand, retailer: product.retailer, sku: product.sku || '', group: product.group as CatalogGroup, category: product.category, width: String(product.width), depth: String(product.depth), height: String(product.height), price: product.price == null ? '' : String(product.price) }
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function PreviewModel({ url, tone, texturePath, textureMaterial, onMaterials }: { url: string; tone: string; texturePath?: string; textureMaterial?: string | null; onMaterials: (names: string[]) => void }) {
  const { scene } = useGLTF(url)
  useEffect(() => onMaterials(productMaterialNames(scene)), [scene, onMaterials])
  return texturePath
    ? <TexturedPreviewModel scene={scene} tone={tone} texturePath={texturePath} textureMaterial={textureMaterial} />
    : <PreviewScene scene={scene} tone={tone} />
}

function PreviewScene({ scene, tone, texture, textureMaterial }: { scene: Group; tone: string; texture?: Texture; textureMaterial?: string | null }) {
  const model = useMemo(() => cloneProductScene(scene, tone, texture, textureMaterial, true), [scene, tone, texture, textureMaterial])
  return <primitive object={model} />
}

function TexturedPreviewModel({ scene, tone, texturePath, textureMaterial }: { scene: Group; tone: string; texturePath: string; textureMaterial?: string | null }) {
  const texture = useTexture(texturePath)
  return <PreviewScene scene={scene} tone={tone} texture={texture} textureMaterial={textureMaterial} />
}

class PreviewError extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFail() }
  render() { return this.state.failed ? <div className="admin-model-error">The model or variant texture could not be previewed.</div> : this.props.children }
}

function ModelPreview({ url, tone, texturePath, textureMaterial, onFail, onMaterials }: { url: string; tone: string; texturePath?: string; textureMaterial?: string | null; onFail: () => void; onMaterials: (names: string[]) => void }) {
  const key = `${url}:${tone}:${texturePath || ''}:${textureMaterial || ''}`
  return <div className="admin-model-preview"><PreviewError key={key} onFail={onFail}><Canvas camera={{ position: [2.8, 2.1, 3.2], fov: 42 }}><color attach="background" args={['#f4f3ef']} /><ambientLight intensity={1.5} /><directionalLight position={[3, 5, 4]} intensity={3} /><Suspense fallback={null}><PreviewModel url={url} tone={tone} texturePath={texturePath} textureMaterial={textureMaterial} onMaterials={onMaterials} /></Suspense><OrbitControls makeDefault /></Canvas></PreviewError></div>
}

export default function CatalogDetailPage({ productId, role, onError, reload }: { productId: string; role: string; onError: (message: string) => void; reload: () => Promise<void> }) {
  const [product, setProduct] = useState<CatalogItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editDraft, setEditDraft] = useState<CatalogDraft | null>(null)
  const [preview, setPreview] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [textureDrafts, setTextureDrafts] = useState<Record<string, TextureDraft>>({})
  const [textureMaterials, setTextureMaterials] = useState<Record<string, string>>({})
  const [textureBusy, setTextureBusy] = useState<string | null>(null)
  const [previewVariantId, setPreviewVariantId] = useState('')
  const [materialNames, setMaterialNames] = useState<string[]>([])
  const textureUrls = useRef(new Set<string>())
  const canManage = atLeast(role, 'admin'), canUpload = canManage && !product?.deleted
  useEffect(() => {
    void send<CatalogItem>(`/api/admin/catalog/${encodeURIComponent(productId)}`).then((item) => { setProduct(item); setEditDraft(catalogDraft(item)); setPreviewVariantId(item.variants?.[0]?.id || '') }).catch((error) => onError(errorText(error)))
  }, [productId, onError])
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => () => textureUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])
  const prepare = (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.glb') || file.size > 18 * 1024 * 1024) { onError('Choose a .glb file smaller than 18 MB.'); return }
    setPreview(URL.createObjectURL(file)); setSelectedFile(file); setMaterialNames([]); setPreviewFailed(false); onError('')
  }
  const prepareTexture = (variant: ProductVariant, file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { onError('Choose a PNG, JPEG, or WebP texture smaller than 10 MB.'); return }
    const old = textureDrafts[variant.id]?.url
    if (old?.startsWith('blob:')) { URL.revokeObjectURL(old); textureUrls.current.delete(old) }
    const url = URL.createObjectURL(file)
    textureUrls.current.add(url)
    setTextureDrafts((current) => ({ ...current, [variant.id]: { file, url, materialName: textureMaterials[variant.id] ?? current[variant.id]?.materialName ?? variant.textureMaterial ?? '' } }))
    setPreviewVariantId(variant.id); setPreviewFailed(false); onError('')
  }
  const upload = async () => {
    const file = selectedFile
    if (!file) return
    setBusy(true); onError('')
    try {
      const result = await send<{ modelPath: string }>(`/api/admin/catalog/${encodeURIComponent(productId)}/model`, 'PUT', { mimeType: 'model/gltf-binary', data: await fileBase64(file) })
      setPreview(result.modelPath); setSelectedFile(null); setPreviewFailed(false); await reload(); setProduct(await send<CatalogItem>(`/api/admin/catalog/${encodeURIComponent(productId)}`))
    } catch (error) { onError(errorText(error)) } finally { setBusy(false) }
  }
  const uploadTexture = async (variant: ProductVariant) => {
    const draft = textureDrafts[variant.id]
    if (!draft) return
    setTextureBusy(variant.id); onError('')
    try {
      await send<{ texturePath: string }>(`/api/admin/catalog/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variant.id)}/texture`, 'PUT', { mimeType: draft.file.type, data: await fileBase64(draft.file), materialName: textureMaterials[variant.id] ?? draft.materialName })
      if (draft.url.startsWith('blob:')) { URL.revokeObjectURL(draft.url); textureUrls.current.delete(draft.url) }
      setTextureDrafts((current) => { const next = { ...current }; delete next[variant.id]; return next })
      setPreviewVariantId(variant.id); setPreviewFailed(false)
      await reload(); setProduct(await send<CatalogItem>(`/api/admin/catalog/${encodeURIComponent(productId)}`))
    } catch (error) { onError(errorText(error)) } finally { setTextureBusy(null) }
  }
  const refreshProduct = async () => {
    const updated = await send<CatalogItem>(`/api/admin/catalog/${encodeURIComponent(productId)}`)
    setProduct(updated); setEditDraft(catalogDraft(updated))
  }
  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault()
    if (!editDraft) return
    setEditBusy(true); onError('')
    try {
      await send(`/api/admin/catalog/${encodeURIComponent(productId)}`, 'PATCH', { overrides: {
        name: editDraft.name, brand: editDraft.brand, retailer: editDraft.retailer, sku: editDraft.sku.trim() || null,
        group: editDraft.group, category: editDraft.category, width: Number(editDraft.width), depth: Number(editDraft.depth), height: Number(editDraft.height),
        price: editDraft.price.trim() ? Number(editDraft.price) : null,
      } })
      await refreshProduct(); await reload()
    } catch (error) { onError(errorText(error)) } finally { setEditBusy(false) }
  }
  const resetMetadata = async () => {
    if (!product?.hasOverrides || !window.confirm('Reset all editable fields to the catalogue source values?')) return
    setEditBusy(true); onError('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(productId)}`, 'PATCH', { overrides: null }); await refreshProduct(); await reload() }
    catch (error) { onError(errorText(error)) } finally { setEditBusy(false) }
  }
  const deleteProduct = async () => {
    if (!product || !window.confirm(`Delete ${product.name} from the catalogue? It will be archived; product data, files, and saved designs will be kept.`)) return
    setEditBusy(true); onError('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(productId)}`, 'DELETE'); await refreshProduct(); await reload() }
    catch (error) { onError(errorText(error)) } finally { setEditBusy(false) }
  }
  const restoreProduct = async () => {
    if (!product || !window.confirm(`Restore ${product.name} to the catalogue?`)) return
    setEditBusy(true); onError('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(productId)}/restore`, 'POST'); await refreshProduct(); await reload() }
    catch (error) { onError(errorText(error)) } finally { setEditBusy(false) }
  }
  if (!product) return <section className="admin-card"><p className="admin-empty">Loading product details…</p></section>
  const info = [
    ['Brand', product.brand], ['Retailer', product.retailer], ['Retailer ID', product.retailerId], ['SKU', product.sku],
    ['Category', `${product.group} · ${product.category}`], ['Dimensions (cm)', `${product.width || 'Missing'} × ${product.depth || 'Missing'} × ${product.height || 'Missing'}`],
    ['Price', euro(product.price)], ['Availability', product.metadata?.availabilityStatus || 'Not provided'], ['Source page', product.sourceUrl],
  ]
  const imageUrls = (product.sourceImages || []).filter((url) => /^https?:\/\//i.test(url))
  const previewVariant = product.variants?.find((variant) => variant.id === previewVariantId) || product.variants?.[0]
  const textureDraft = previewVariant ? textureDrafts[previewVariant.id] : undefined
  const modelUrl = preview || previewVariant?.modelPath || product.modelPath
  const previewTexture = textureDraft?.url || previewVariant?.texturePath || undefined
  const previewMaterial = textureMaterials[previewVariant?.id || ''] ?? textureDraft?.materialName ?? previewVariant?.textureMaterial
  const previewTone = previewVariant?.tone || product.tone
  const textureTargetAvailable = previewMaterial
    ? materialNames.some((name) => name.toLowerCase() === previewMaterial.toLowerCase())
    : materialNames.some((name) => /upholstery|cushion|fabric/i.test(name))
  const changeTextureMaterial = (variant: ProductVariant, value: string) => {
    setTextureMaterials((current) => ({ ...current, [variant.id]: value }))
    setTextureDrafts((current) => current[variant.id] ? { ...current, [variant.id]: { ...current[variant.id], materialName: value } } : current)
    setPreviewVariantId(variant.id); setPreviewFailed(false)
  }
  return <div className="admin-product-detail">
    <a className="admin-back-link" href="/admin?tab=catalogue">← Catalogue</a>
    <section className="admin-card"><header className="admin-card-head"><div><span className="admin-eyebrow">Product record · {product.id}</span><h2>{product.name}</h2><p>{product.status}</p></div><span className={`admin-pill ${product.deleted ? 'admin-pill-deleted' : `admin-pill-${product.review}`}`}>{product.deleted ? 'Archived' : product.review}</span></header>
      {canManage && <div className="admin-actions">{product.deleted ? <button className="admin-primary-inline" type="button" disabled={editBusy} onClick={() => void restoreProduct()}>Restore product</button> : <button className="admin-row-action admin-row-danger" type="button" disabled={editBusy} onClick={() => void deleteProduct()}>Delete product</button>}</div>}
      {product.missingFields?.length ? <div className="admin-missing"><strong>Missing information</strong><span>{product.missingFields.join(' · ')}</span></div> : null}
      <dl className="admin-product-facts">{info.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{key === 'Source page' && value ? <a href={String(value)} target="_blank" rel="noreferrer">Open source ↗</a> : String(value || 'Not provided')}</dd></div>)}</dl>
      {canManage && editDraft && !product.deleted && <form className="admin-catalog-edit-form" onSubmit={(event) => void saveMetadata(event)}>
        <div className="admin-card-head"><div><span className="admin-eyebrow">Admin overrides</span><h3>Edit catalogue metadata</h3></div></div>
        <p className="admin-help">These values override the bundled or imported source for the planner. Dimension changes affect product placement. Reset restores all original values.</p>
        <div className="admin-form-grid">
          <label>Product name<input value={editDraft.name} maxLength={160} required onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} /></label>
          <label>Brand<input value={editDraft.brand} maxLength={120} required onChange={(event) => setEditDraft({ ...editDraft, brand: event.target.value })} /></label>
          <label>Retailer<input value={editDraft.retailer} maxLength={120} required onChange={(event) => setEditDraft({ ...editDraft, retailer: event.target.value })} /></label>
          <label>SKU<input value={editDraft.sku} maxLength={100} onChange={(event) => setEditDraft({ ...editDraft, sku: event.target.value })} /></label>
          <label>Product group<select value={editDraft.group} onChange={(event) => setEditDraft({ ...editDraft, group: event.target.value as CatalogGroup })}>{catalogGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label>Category<input value={editDraft.category} maxLength={80} required onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })} /></label>
          <label>Width (cm)<input type="number" min="0" max="2000" step="0.1" value={editDraft.width} required onChange={(event) => setEditDraft({ ...editDraft, width: event.target.value })} /></label>
          <label>Depth (cm)<input type="number" min="0" max="2000" step="0.1" value={editDraft.depth} required onChange={(event) => setEditDraft({ ...editDraft, depth: event.target.value })} /></label>
          <label>Height (cm)<input type="number" min="0" max="2000" step="0.1" value={editDraft.height} required onChange={(event) => setEditDraft({ ...editDraft, height: event.target.value })} /></label>
          <label>Price<input type="number" min="0" max="100000000" step="0.01" value={editDraft.price} onChange={(event) => setEditDraft({ ...editDraft, price: event.target.value })} /></label>
        </div>
        <div className="admin-actions"><button className="admin-primary-inline" type="submit" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save metadata'}</button>{product.hasOverrides && <button className="admin-row-action" type="button" disabled={editBusy} onClick={() => void resetMetadata()}>Reset to source</button>}</div>
      </form>}
      <h3>3D model</h3>{modelUrl ? <ModelPreview url={modelUrl} tone={previewTone} texturePath={previewTexture} textureMaterial={previewMaterial} onFail={() => setPreviewFailed(true)} onMaterials={setMaterialNames} /> : <div className="admin-model-empty">No GLB uploaded yet.</div>}
      {canUpload && <><label className="admin-model-upload">Replace 3D model (.glb, max 18 MB)<input type="file" accept=".glb,model/gltf-binary" disabled={busy} onChange={(event) => prepare(event.target.files?.[0])} /></label>{selectedFile && <button className="admin-primary" disabled={busy || previewFailed} onClick={() => void upload()}>{previewFailed ? 'Preview failed; choose another GLB' : 'Upload this model'}</button>}</>}
      {!canManage && <p className="admin-help">Admin role is required to upload a model.</p>}
      {canManage && product.deleted && <p className="admin-help">Restore this product before uploading a model or texture.</p>}
      {busy && <p role="status" className="admin-help">Uploading and checking the model…</p>}
    </section>
    {product.variants?.length ? <section className="admin-card"><h3>Colour variant textures</h3><p className="admin-help">Upload one texture per colour. The texture must match this model’s UV layout. Choose a material name from the preview, or use the automatic upholstery/cushion/fabric match.</p>
      <div className="admin-variant-textures">{product.variants.map((variant) => {
        const draft = textureDrafts[variant.id], target = textureMaterials[variant.id] ?? draft?.materialName ?? variant.textureMaterial ?? ''
        return <article className={`admin-variant-texture ${previewVariant?.id === variant.id ? 'admin-variant-texture-active' : ''}`} key={variant.id}>
          <div className="admin-variant-texture-head"><div><strong>{variant.name}</strong><small>{variant.sourceVariantName || variant.colorName || variant.id}</small></div><button type="button" className="admin-secondary" aria-pressed={previewVariant?.id === variant.id} onClick={() => { setPreviewVariantId(variant.id); setPreviewFailed(false) }}>Preview</button></div>
          {(draft?.url || variant.texturePath) ? <img className="admin-variant-texture-image" src={draft?.url || variant.texturePath!} alt={`${variant.name} texture preview`} /> : <p className="admin-empty">No variant texture uploaded.</p>}
          {previewVariant?.id === variant.id && (draft?.url || variant.texturePath) && !textureTargetAvailable ? <p className="admin-help">{materialNames.length ? 'Selected texture target is not present in this GLB; choose a listed material and upload the texture again.' : 'No textile material names were found in this GLB. Select a material if one becomes available.'}</p> : null}
          {canUpload && modelUrl && <>
            <label>GLB material<select aria-label={`Texture material for ${variant.name}`} value={target} onChange={(event) => changeTextureMaterial(variant, event.target.value)}><option value="">Automatic textile materials</option>{materialNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="admin-model-upload">Texture image (.png, .jpg, .webp, max 10 MB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={textureBusy !== null} onChange={(event) => { prepareTexture(variant, event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
            {draft?.file && <button type="button" className="admin-primary" disabled={textureBusy !== null || previewFailed} onClick={() => void uploadTexture(variant)}>{textureBusy === variant.id ? 'Uploading…' : `Save ${variant.name} texture`}</button>}
          </>}
          {canUpload && !modelUrl && <p className="admin-help">Upload the GLB before adding a texture for this variant.</p>}
        </article>
      })}</div>
    </section> : null}
    {imageUrls.length ? <section className="admin-card"><h3>Source images</h3><div className="admin-image-gallery">{imageUrls.map((image, index) => <a key={image} href={image} target="_blank" rel="noreferrer"><img src={image} loading="lazy" alt={`${product.name} source ${index + 1}`} /></a>)}</div></section> : null}
    {product.metadata && <section className="admin-card"><h3>Extracted metadata</h3>{product.metadata.description && <p>{product.metadata.description}</p>}<dl className="admin-product-facts">{Object.entries(product.metadata.materials || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || 'Not provided'}</dd></div>)}{product.metadata.attributes.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      {product.metadata.warnings.length > 0 && <ul className="admin-warnings">{product.metadata.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <p className="admin-help">Collected {product.metadata.extractedAt} · {product.metadata.extractor}</p>
    </section>}
    {product.verification?.warnings?.length ? <section className="admin-card"><h3>Verification notes</h3><ul className="admin-warnings">{product.verification.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
    <details className="admin-card"><summary>Complete product record</summary><pre className="admin-record-json">{JSON.stringify(product, null, 2)}</pre></details>
  </div>
}
