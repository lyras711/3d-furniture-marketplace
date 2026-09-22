import { generatedProducts } from './catalog.generated'

export type CategoryFilter = 'All' | 'Seating' | 'Tables' | 'Lighting' | 'Decor' | 'Storage' | 'Bedroom' | 'Kitchen' | 'Bathroom'

export interface ProductVariant {
  id: string
  name: string
  sourceVariantName?: string
  colorName?: string | null
  tone?: string
  accent?: string
  modelPath?: string | null
  thumbnailPath?: string | null
  materialReference?: string
  sourceAvailability?: string | null
}

export interface Product {
  id: string
  name: string
  brand: string
  retailer: string
  retailerId?: string
  retailerName?: string
  sku: string | null
  group: CategoryFilter
  category: string
  width: number
  depth: number
  height: number
  cornerDepth?: number | null
  seatHeight?: number | null
  feetHeight?: number | null
  price: number | null
  currency?: string
  tone: string
  accent: string
  status: string
  sourceUrl?: string
  localizedNames?: Record<string, string>
  modelPath?: string | null
  thumbnailPath?: string | null
  variants?: ProductVariant[]
  sourceImages?: string[]
  verification?: {
    productData: string
    model: string
    dimensions: string
    generatedAsset: string
    humanReview: string
    warnings: string[]
  }
}

export const products: Product[] = [
  {
    id: 'sofa-haven',
    name: 'Haven three-seat sofa',
    brand: 'Noma Home',
    retailer: 'The Living House',
    sku: 'NH-HAV-220',
    group: 'Seating',
    category: 'Sofa',
    width: 220,
    depth: 92,
    height: 82,
    price: 899,
    tone: '#c9b9a4',
    accent: '#a28c75',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'chair-arc',
    name: 'Arc dining chair',
    brand: 'Minoa Studio',
    retailer: 'Minoa Studio',
    sku: 'MS-ARC-001',
    group: 'Seating',
    category: 'Dining chair',
    width: 48,
    depth: 52,
    height: 80,
    price: 129,
    tone: '#d8cab7',
    accent: '#867763',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'table-form',
    name: 'Form dining table',
    brand: 'Noma Home',
    retailer: 'The Living House',
    sku: 'NH-FRM-180',
    group: 'Tables',
    category: 'Dining table',
    width: 180,
    depth: 90,
    height: 75,
    price: 599,
    tone: '#bd8b5d',
    accent: '#8c603c',
    status: 'Price to verify',
  },
  {
    id: 'table-arc',
    name: 'Arc coffee table',
    brand: 'Minoa Studio',
    retailer: 'Minoa Studio',
    sku: 'MS-ARC-110',
    group: 'Tables',
    category: 'Coffee table',
    width: 110,
    depth: 60,
    height: 38,
    price: 249,
    tone: '#d4b58d',
    accent: '#a77f54',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'rug-loom',
    name: 'Loom wool rug',
    brand: 'Atelier 27',
    retailer: 'Atelier 27',
    sku: 'AT-LOOM-240',
    group: 'Decor',
    category: 'Rug',
    width: 240,
    depth: 170,
    height: 1,
    price: 179,
    tone: '#ded6c6',
    accent: '#b0a48f',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'unit-line',
    name: 'Line media console',
    brand: 'Minoa Studio',
    retailer: 'Minoa Studio',
    sku: 'MS-LIN-180',
    group: 'Storage',
    category: 'TV unit',
    width: 180,
    depth: 42,
    height: 52,
    price: 329,
    tone: '#c8a477',
    accent: '#8b6847',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'lamp-halo',
    name: 'Halo floor lamp',
    brand: 'Luma Objects',
    retailer: 'Luma Objects',
    sku: 'LO-HALO-001',
    group: 'Lighting',
    category: 'Floor lamp',
    width: 42,
    depth: 42,
    height: 150,
    price: 139,
    tone: '#d1a45f',
    accent: '#6f6255',
    status: 'Stock to verify',
  },
  {
    id: 'plant-olive',
    name: 'Olive tree, 120 cm',
    brand: 'Green Room',
    retailer: 'Green Room',
    sku: 'GR-OLV-120',
    group: 'Decor',
    category: 'Plant',
    width: 48,
    depth: 48,
    height: 130,
    price: 89,
    tone: '#73896d',
    accent: '#49604c',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'shelf-frame',
    name: 'Frame open shelving',
    brand: 'Atelier 27',
    retailer: 'Atelier 27',
    sku: 'AT-FRM-090',
    group: 'Storage',
    category: 'Shelving',
    width: 90,
    depth: 34,
    height: 190,
    price: 389,
    tone: '#b9956e',
    accent: '#76583f',
    status: 'Sample · price & stock unverified',
  },
  {
    id: 'bed-cloud',
    name: 'Cloud upholstered bed',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BED-180',
    group: 'Bedroom',
    category: 'Bed',
    width: 180,
    depth: 210,
    height: 105,
    price: null,
    tone: '#b8aa9b',
    accent: '#735f50',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'nightstand-form',
    name: 'Form bedside table',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BED-002',
    group: 'Bedroom',
    category: 'Nightstand',
    width: 50,
    depth: 42,
    height: 55,
    price: null,
    tone: '#c6a47d',
    accent: '#76563c',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'toilet-arc',
    name: 'Arc close-coupled toilet',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BATH-001',
    group: 'Bathroom',
    category: 'Toilet',
    width: 40,
    depth: 68,
    height: 82,
    price: null,
    tone: '#e9e7df',
    accent: '#9ca49d',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'shower-frame',
    name: 'Frame glass shower',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BATH-002',
    group: 'Bathroom',
    category: 'Shower',
    width: 90,
    depth: 90,
    height: 220,
    price: null,
    tone: '#b9d6d4',
    accent: '#6c817e',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'bath-curve',
    name: 'Curve freestanding bath',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BATH-003',
    group: 'Bathroom',
    category: 'Bathtub',
    width: 170,
    depth: 78,
    height: 60,
    price: null,
    tone: '#e4e1d8',
    accent: '#9aa39b',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'vanity-stone',
    name: 'Stone bathroom vanity',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-BATH-004',
    group: 'Bathroom',
    category: 'Bathroom vanity',
    width: 100,
    depth: 52,
    height: 86,
    price: null,
    tone: '#c7b7a2',
    accent: '#746856',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'counter-line',
    name: 'Line kitchen counter',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-KITCHEN-001',
    group: 'Kitchen',
    category: 'Kitchen counter',
    width: 240,
    depth: 65,
    height: 92,
    price: null,
    tone: '#c7ad88',
    accent: '#77604a',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'island-form',
    name: 'Form kitchen island',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-KITCHEN-002',
    group: 'Kitchen',
    category: 'Kitchen island',
    width: 180,
    depth: 90,
    height: 92,
    price: null,
    tone: '#b9a58a',
    accent: '#6f5945',
    status: 'Temporary model · illustrative dimensions',
  },
  {
    id: 'fridge-tall',
    name: 'Tall kitchen refrigerator',
    brand: 'Formivo sample',
    retailer: 'Formivo temporary',
    sku: 'TMP-KITCHEN-003',
    group: 'Kitchen',
    category: 'Refrigerator',
    width: 90,
    depth: 72,
    height: 200,
    price: null,
    tone: '#aeb3af',
    accent: '#59615f',
    status: 'Temporary model · illustrative dimensions',
  },
  ...generatedProducts,
]
