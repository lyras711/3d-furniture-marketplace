/**
 * Initial catalog sources: retailers/manufacturers that may supply existing
 * 3D models instead of generated geometry.
 *
 * Statuses:
 * - 'exportable-configurator': a Unity WebGL configurator (Exact3D/ExactADV
 *   Player) was verified on 2026-09-17 to expose a client-side GLB export
 *   (SendMessage 'SimpleExport' + downloadGL(B).js). Model ids are public
 *   URL parameters. Still requires a licensing/partnership OK before
 *   redistribution, but assets are technically obtainable.
 * - 'partnership-required': no downloadable assets found; treat as a
 *   partnership/API/manual-import lead only. Do not scrape protected assets.
 * - 'materials-source': useful for surface/fabric material assets, not
 *   finished furniture geometry. Store under a materials library, not the
 *   product catalog.
 *
 * Every entry was verified against the live site; unverifiable claims are
 * recorded in notes, never as product data.
 */

export type CatalogSourceStatus = 'exportable-configurator' | 'partnership-required' | 'materials-source'
export type CatalogSourceKind = 'furniture-3d' | 'materials'
export type ConfiguratorEngine = 'exact3d-player' | 'exactadv-player'

export interface ConfiguratorModelSource {
  engine: ConfiguratorEngine
  configuratorUrl: string
  /** Query parameter carrying the product model id (e.g. `?model=kan_canova`). */
  modelParam: 'model'
  /** Verified client-side GLB export mechanism. */
  glbExport: 'unity-sendmessage-simpleexport'
  /** Model ids discovered on the public site; not an exhaustive list. */
  knownModels: string[]
  /** Where additional model ids can be found. */
  modelDiscovery: string
}

export interface CatalogSource {
  id: string
  name: string
  website: string
  priority: 'high' | 'medium'
  kind: CatalogSourceKind
  status: CatalogSourceStatus
  productTypes: string[]
  models?: ConfiguratorModelSource
  notes: string
  verifiedAt: string
}

export const catalogSources: CatalogSource[] = [
  {
    id: 'al2',
    name: 'al2',
    website: 'https://www.al2.gr/',
    priority: 'high',
    kind: 'furniture-3d',
    status: 'exportable-configurator',
    productTypes: ['dining-tables', 'chairs', 'lounge-chairs', 'low-tables', 'side-tables', 'sideboards', 'highboards', 'lowboards', 'bookcases', 'desks-and-consoles', 'tv-units', 'bedrooms', 'mirrors'],
    models: {
      engine: 'exact3d-player',
      configuratorUrl: 'https://configurator.al2.gr/',
      modelParam: 'model',
      glbExport: 'unity-sendmessage-simpleexport',
      knownModels: ['dining_table_prism_001'],
      modelDiscovery: 'Each product page links to the configurator, e.g. https://configurator.al2.gr/?model=dining_table_prism_001&lang=en&multi=1',
    },
    notes: 'Product pages are WooCommerce under /product/<slug>/ and carry per-product configurator links with the model id. Investigate whether models can be supplied through a commercial partnership before redistribution.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'ikea-greece',
    name: 'IKEA Greece',
    website: 'https://www.ikea.gr/',
    priority: 'high',
    kind: 'furniture-3d',
    status: 'partnership-required',
    productTypes: ['broad furniture catalog'],
    notes: 'No downloadable 3D assets found on the public site. Room-planning and product-visualization assets are protected — do not scrape or reuse. Partnership/API/manual-import lead only.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'homad',
    name: 'HOMAD',
    website: 'https://www.homad.eu/',
    priority: 'medium',
    kind: 'furniture-3d',
    status: 'exportable-configurator',
    productTypes: ['sofas', 'armchairs', 'living-room furniture', 'dining furniture', 'bedroom furniture'],
    models: {
      engine: 'exact3d-player',
      configuratorUrl: 'https://configurator.homad.eu/',
      modelParam: 'model',
      glbExport: 'unity-sendmessage-simpleexport',
      knownModels: ['kan_canova', 'kan_brutus', 'kan_moby', 'kan_da_capo', 'kan_nobilis', 'kan_cosimo', 'kan_balzac_ii', 'kan_vertigo', 'kan_noa', 'kan_harem', 'kan_borghese', 'kan_galileo', 'kan_blow_up', 'kan_terra', 'kan_pasha'],
      modelDiscovery: 'https://www.homad.eu/product-category/configurator/ lists products linking to https://configurator.homad.eu/?model=<id>',
    },
    notes: 'homad.gr is a frameset redirect to homad.eu — the real site. Configurator is the same Exact3D Unity player as al2.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'grecostrom',
    name: 'GrecoStrom',
    website: 'https://www.grecostrom.gr/',
    priority: 'medium',
    kind: 'furniture-3d',
    status: 'exportable-configurator',
    productTypes: ['mattresses', 'beds', 'pillows', 'bedroom furniture'],
    models: {
      engine: 'exactadv-player',
      configuratorUrl: 'https://configurator.grecostrom.gr/',
      modelParam: 'model',
      glbExport: 'unity-sendmessage-simpleexport',
      knownModels: ['HERMES', 'PTY_ARTEMIS'],
      modelDiscovery: 'Configurator UI exposes model ids; product pages link to https://configurator.grecostrom.gr/',
    },
    notes: 'ExactADV Player (same vendor family as Exact3D). js/downloadGL.js calls Unity SendMessage("GameAssetsHandler","SimpleExport") and downloads the returned GLB — export is a built-in user feature.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'alfawood',
    name: 'AlfaWood',
    website: 'https://www.alfawood.gr/',
    priority: 'medium',
    kind: 'materials',
    status: 'materials-source',
    productTypes: ['wood products', 'surfaces', 'materials'],
    notes: 'Site embeds Roomvo (2D floor visualizer) — no downloadable 3D furniture models found. More useful for materials/textures than finished furniture; a product feed would need a partnership.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'xylokat',
    name: 'Xylokat',
    website: 'https://www.xylokat.gr/',
    priority: 'medium',
    kind: 'materials',
    status: 'materials-source',
    productTypes: ['wood surfaces', 'architectural materials'],
    notes: '"3D" products are relief-surface panels, not downloadable 3D models. Store materials separately from furniture products.',
    verifiedAt: '2026-09-17',
  },
  {
    id: 'hit-fabrics',
    name: 'HIT Fabrics',
    website: 'https://hitfabrics.com/',
    priority: 'medium',
    kind: 'materials',
    status: 'materials-source',
    productTypes: ['upholstery fabrics', 'materials'],
    notes: 'hit-fabrics.gr does not resolve (NXDOMAIN); the real site is hitfabrics.com (The Fabulous Group, Athens). Fabric/upholstery materials — store as material assets and link to compatible furniture products.',
    verifiedAt: '2026-09-17',
  },
]

export function catalogSource(id: string) {
  return catalogSources.find((source) => source.id === id)
}
