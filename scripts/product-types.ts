export type Confidence = 'high' | 'medium' | 'low'

export interface FieldProvenance {
  field: string
  value: unknown
  source: string
  confidence: Confidence
}

export interface PackageDimensionsCm {
  length: number | null
  width: number | null
  height: number | null
}

export interface SourceImage {
  id: string
  sourceUrl: string
  localPath: string | null
  contentType: string | null
  width: number | null
  height: number | null
  role: 'hero' | 'gallery' | 'variant-swatch' | 'technical' | 'installation' | 'packaging' | 'unknown'
  variantId: string | null
  altText: string | null
  downloaded: boolean
  sha256: string | null
  warning: string | null
}

export interface Variant {
  id: string
  productId: string
  sourceVariantName: string
  normalizedVariantName: string
  colorName: string | null
  materialName: string | null
  sourceImageUrls: string[]
  localImagePaths: string[]
  materialReference: string
  modelAssetId: string | null
  sourceAvailability: string | null
  sourcePrice: number | null
  extractionWarnings: string[]
}

export interface ModelAsset {
  id: string
  productId: string
  variantId: string | null
  format: 'glb' | 'gltf'
  localPath: string
  publicPathOrStorageKey: string
  thumbnailPath: string | null
  dimensionsCm: {
    length: number | null
    depth: number | null
    height: number | null
  }
  polygonCount: number | null
  generationMethod: string
  visualAccuracy?: 'pending-human-review'
  materialStatus?: string
  generationWarnings?: string[]
  generationStatus: 'generated' | 'failed' | 'pending'
  validationStatus: 'validated' | 'failed' | 'pending'
  createdAt: string
}

export interface NormalizedProduct {
  id: string
  retailerId: string
  sourceUrl: string
  sourceProductCode: string | null
  name: string | null
  localizedNames: Record<string, string>
  brand: string | null
  category: string | null
  description: string | null
  currency: string | null
  basePrice: number | null
  availabilityStatus: string | null
  dimensionsCm: {
    length: number | null
    width: number | null
    depth: number | null
    height: number | null
    cornerDepth: number | null
    seatHeight: number | null
    feetHeight: number | null
    bedLength: number | null
    bedWidth: number | null
  }
  materials: {
    frame: string | null
    seat: string | null
    upholstery: string | null
    feet: string | null
  }
  packageCount: number | null
  weightKg: number | null
  packageDimensions: PackageDimensionsCm[]
  variants: Variant[]
  sourceImages: SourceImage[]
  modelAssets: ModelAsset[]
  extractionMetadata: {
    extractedAt: string
    extractor: string
    pageTitle: string | null
    canonicalUrl: string | null
    provenance: FieldProvenance[]
    warnings: string[]
    sourceStrategies: string[]
  }
  validationStatus: 'source-extracted' | 'warnings' | 'invalid'
  /** Optional catalog display overrides; defaults in register-catalog preserve Polihome/Vancouver records. */
  catalog?: {
    retailerName?: string
    group?: 'Seating' | 'Tables' | 'Lighting' | 'Decor' | 'Storage' | 'Bedroom'
    category?: string
  }
  createdAt: string
  updatedAt: string
}

export interface RawImage {
  sourceUrl: string
  altText: string | null
  width: number | null
  height: number | null
  context: string
  isProductImage: boolean
}

export interface VariantControl {
  sourceVariantName: string
  controlId: string | null
  imageUrl: string | null
  selected: boolean
}

export interface PageSnapshot {
  url: string
  canonicalUrl: string | null
  title: string
  text: string
  html: string
  jsonLd: unknown[]
  images: RawImage[]
  variantControls: VariantControl[]
  variantStates: Array<{
    sourceVariantName: string
    controlId: string | null
    url: string
    text: string
    jsonLd: unknown[]
    images: RawImage[]
  }>
}

export interface CatalogVariantRecord {
  id: string
  name: string
  sourceVariantName: string
  colorName: string | null
  tone: string
  accent: string
  modelPath: string | null
  thumbnailPath: string | null
  materialReference: string
  sourceAvailability: string | null
}

export interface CatalogProductRecord {
  id: string
  retailerId: string
  retailerName: string
  retailer: string
  sourceUrl: string
  sku: string | null
  name: string
  localizedNames: Record<string, string>
  brand: string
  group: 'Seating' | 'Tables' | 'Lighting' | 'Decor' | 'Storage' | 'Bedroom'
  category: string
  width: number
  depth: number
  height: number
  cornerDepth: number | null
  seatHeight: number | null
  feetHeight: number | null
  price: number | null
  currency: string
  tone: string
  accent: string
  status: string
  thumbnailPath: string | null
  modelPath: string | null
  variants: CatalogVariantRecord[]
  sourceImages: string[]
  verification: {
    productData: 'extracted' | 'partial' | 'failed'
    model: 'generated' | 'pending' | 'failed'
    dimensions: 'validated' | 'pending' | 'failed'
    generatedAsset: 'approximate' | 'failed'
    humanReview: 'pending'
    warnings: string[]
  }
}
