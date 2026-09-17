import type { Page } from '@playwright/test'
import type { NormalizedProduct, PageSnapshot, RawImage, VariantControl } from '../product-types'

const productUrlToken = /vancouver|162638009|goniakos|γωνιακός/i
const imageUrlPattern = /^https?:\/\//i

const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
const unique = <T>(values: T[]) => [...new Set(values)]

function parseJsonLd(text: string | null) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const graph = Array.isArray(record['@graph']) ? record['@graph'] : []
  return [record, ...graph.flatMap(records)]
}

function productSchema(snapshot: Pick<PageSnapshot, 'jsonLd'>) {
  return snapshot.jsonLd.flatMap(records).find((record) => {
    const type = record['@type']
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'))
  }) || null
}

function offerFrom(snapshot: Pick<PageSnapshot, 'jsonLd'>) {
  const product = productSchema(snapshot)
  const offer = product?.offers
  if (Array.isArray(offer)) return offer[0] as Record<string, unknown> | undefined
  return offer && typeof offer === 'object' ? offer as Record<string, unknown> : undefined
}

async function readPageSnapshot(page: Page): Promise<PageSnapshot> {
  const data = await page.evaluate(() => {
    const imageData = [...document.images].map((image) => {
      const contextValues: string[] = []
      let contextNode: HTMLElement | null = image.parentElement
      for (let i = 0; contextNode && i < 5; i += 1) {
        contextValues.push(`${contextNode.id} ${typeof contextNode.className === 'string' ? contextNode.className : ''}`)
        contextNode = contextNode.parentElement
      }
      const sourceUrl = image.currentSrc || image.src
      const context = contextValues.join(' | ')
      const altText = image.alt || null
      const isProductImage = Boolean(sourceUrl && sourceUrl.startsWith('http') && image.naturalWidth > 20 && image.naturalHeight > 20 && !/bat\.bing|stat-track|pixel\.|analytics/i.test(sourceUrl) && (
        /swiper-img|swipper-thumps-images|variation-color-option|description-image|dimensions-image/i.test(context)
        || /vancouver|162638009|goniakos|γωνιακός/i.test(`${sourceUrl} ${altText || ''}`)
      ))
      return { sourceUrl, altText, width: image.naturalWidth || null, height: image.naturalHeight || null, context, isProductImage }
    }).filter((image) => image.isProductImage)
    const jsonLd = [...document.scripts]
      .filter((script) => script.type === 'application/ld+json')
      .map((script) => script.textContent)
      .map((text) => {
        try { return text ? JSON.parse(text) : null } catch { return null }
      })
      .filter(Boolean)
    const variantControls = [...document.querySelectorAll('[data-action*="selectVariation"], .variation-color-option')]
      .map((element) => {
        const sourceVariantName = (element.querySelector('span')?.textContent || element.textContent || '').replace(/\s+/g, ' ').trim()
        const image = element.querySelector('img') as HTMLImageElement | null
        const imageUrl = image?.currentSrc || image?.src || null
        return {
          sourceVariantName,
          controlId: element.getAttribute('data-color-option-id'),
          imageUrl,
          selected: element.classList.contains('selected-product-thumbnail') || element.classList.contains('active'),
        }
      })
      .filter((control) => control.sourceVariantName)
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null
    return {
      url: location.href,
      canonicalUrl: canonical,
      title: document.title,
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
      jsonLd,
      images: imageData,
      variantControls,
      variantStates: [],
    }
  })
  return data
}

export async function capturePolihomePage(page: Page): Promise<PageSnapshot> {
  await page.waitForTimeout(800)
  const initial = await readPageSnapshot(page)
  const states: PageSnapshot['variantStates'] = []
  for (const control of initial.variantControls) {
    try {
      const safeControlId = control.controlId?.replace(/["\\]/g, '')
      const selector = safeControlId
        ? `[data-color-option-id="${safeControlId}"]`
        : '.variation-color-option'
      const locator = control.controlId ? page.locator(selector).first() : page.locator('.variation-color-option').filter({ hasText: control.sourceVariantName }).first()
      if (!(await locator.count())) continue
      await locator.click({ timeout: 3000 })
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ])
      const state = await readPageSnapshot(page)
      states.push({
        sourceVariantName: control.sourceVariantName,
        controlId: control.controlId,
        url: state.url,
        text: state.text,
        jsonLd: state.jsonLd,
        images: state.images,
      })
    } catch {
      states.push({ sourceVariantName: control.sourceVariantName, controlId: control.controlId, url: initial.url, text: initial.text, jsonLd: initial.jsonLd, images: [] })
    }
  }
  return { ...initial, variantStates: states }
}

function parseNumber(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function labelNumber(text: string, label: string) {
  const match = text.match(new RegExp(`${label}\\s*:?\\s*([0-9]+(?:[.,][0-9]+)?)`, 'i'))
  return parseNumber(match?.[1])
}

function labelText(text: string, label: string) {
  const match = text.match(new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i'))
  return clean(match?.[1]) || null
}

function section(text: string, start: string, end?: string) {
  const startIndex = text.toLocaleLowerCase('el').indexOf(start.toLocaleLowerCase('el'))
  if (startIndex < 0) return text
  const remainder = text.slice(startIndex + start.length)
  const endIndex = end ? remainder.toLocaleLowerCase('el').indexOf(end.toLocaleLowerCase('el')) : -1
  return endIndex >= 0 ? remainder.slice(0, endIndex) : remainder
}

function nameFrom(snapshot: PageSnapshot, product: Record<string, unknown> | null) {
  const lines = snapshot.text.split(/\n+/).map(clean).filter(Boolean)
  const heading = lines.find((line) => /^Γωνιακός\s+Καναπές\s+Vancouver$/i.test(line))
    || lines.find((line) => /^Γωνιακός\s+Καναπές\s+Vancouver\b/i.test(line))
  if (heading) return heading.replace(/\s+-\s+Γκρι.*$/i, '').trim()
  const jsonName = typeof product?.name === 'string' ? product.name : ''
  return jsonName.replace(/\s+-\s+Γκρι.*?(?=\s+-\s+με|\s*\|)/i, '').replace(/\s*\|\s*Polihome.*$/i, '').trim() || null
}

function keyPart(value: string) {
  const ascii = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (ascii) return ascii
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ (character.codePointAt(0) || 0), 16777619)
  return `variant-${(hash >>> 0).toString(36)}`
}

function variantId(sourceVariantName: string, prefix: string) {
  const value = sourceVariantName.toLocaleLowerCase('el')
  if (/ανοιχτό|light/.test(value)) return `${prefix}-grey-light`
  if (/σκούρο|dark/.test(value)) return `${prefix}-grey-dark`
  return `${prefix}-${keyPart(sourceVariantName)}`
}

function normalizedVariantName(sourceVariantName: string) {
  const value = sourceVariantName.toLocaleLowerCase('el')
  if (/ανοιχτό|light/.test(value)) return 'Grey Light'
  if (/σκούρο|dark/.test(value)) return 'Grey Dark'
  return sourceVariantName
}

function variantColor(sourceVariantName: string) {
  const value = sourceVariantName.toLocaleLowerCase('el')
  if (/ανοιχτό|light/.test(value)) return 'light grey'
  if (/σκούρο|dark/.test(value)) return 'dark grey'
  return null
}

function imageRole(image: RawImage) {
  const value = `${image.sourceUrl} ${image.altText || ''} ${image.context}`.toLocaleLowerCase('el')
  if (/variation-color-option|option-image|width=500.*height=500/.test(value)) return 'variant-swatch' as const
  if (/dimension|διαστασ|technical|τεχνικ/.test(value)) return 'technical' as const
  if (/install|οδηγι|assembly|συναρμολ/.test(value)) return 'installation' as const
  if (/pack|συσκευασ/.test(value)) return 'packaging' as const
  return 'gallery' as const
}

function makeSourceImages(snapshot: PageSnapshot, variants: VariantControl[], prefix: string) {
  const product = productSchema(snapshot)
  const jsonImages = typeof product?.image === 'string' ? [product.image] : Array.isArray(product?.image) ? product.image.filter((value): value is string => typeof value === 'string') : []
  const candidates = [
    ...snapshot.images,
    ...snapshot.variantStates.flatMap((state) => state.images.map((image) => ({ ...image, variantId: variantId(state.sourceVariantName, prefix) }))),
    ...variants.map((variant) => ({ sourceUrl: variant.imageUrl || '', altText: variant.sourceVariantName, width: null, height: null, context: 'variation-color-option', isProductImage: true, variantId: variantId(variant.sourceVariantName, prefix) })),
    ...jsonImages.map((sourceUrl) => ({ sourceUrl, altText: null, width: null, height: null, context: 'JSON-LD Product image', isProductImage: true, variantId: null })),
  ].filter((image) => image.sourceUrl && imageUrlPattern.test(image.sourceUrl))
  const seen = new Set<string>()
  return candidates.flatMap((image, index) => {
    const key = image.sourceUrl
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      id: `source-image-${index + 1}`,
      sourceUrl: image.sourceUrl,
      localPath: null,
      contentType: null,
      width: image.width,
      height: image.height,
      role: imageRole(image),
      variantId: 'variantId' in image && typeof image.variantId === 'string' ? image.variantId : null,
      altText: image.altText,
      downloaded: false,
      sha256: null,
      warning: null,
    }]
  })
}

function stateImages(snapshot: PageSnapshot, sourceVariantName: string, prefix: string) {
  const id = variantId(sourceVariantName, prefix)
  const state = snapshot.variantStates.find((candidate) => candidate.sourceVariantName === sourceVariantName)
  const selectedInitially = snapshot.variantControls.some((control) => control.sourceVariantName === sourceVariantName && control.selected)
  const urls = [
    ...(selectedInitially ? snapshot.images : []).filter((image) => /swiper-img|swipper-thumps-images/i.test(image.context)).map((image) => image.sourceUrl),
    ...(state?.images || []).filter((image) => image.isProductImage && /swiper-img|swipper-thumps-images/i.test(image.context)).map((image) => image.sourceUrl),
    ...snapshot.variantControls.filter((control) => control.sourceVariantName === sourceVariantName).map((control) => control.imageUrl || ''),
  ]
  return { id, urls: unique(urls.filter(Boolean)) }
}

export function extractPolihome(snapshot: PageSnapshot): NormalizedProduct {
  const product = productSchema(snapshot)
  const offer = offerFrom(snapshot)
  const technical = section(snapshot.text, 'Τεχνικά Χαρακτηριστικά', 'Αξιολογήσεις')
  const dimensions = section(technical, 'Διαστάσεις (εκατ)', 'Υλικά κατασκευής')
  const materials = section(technical, 'Υλικά κατασκευής', 'Σημειώσεις')
  const notes = section(technical, 'Σημειώσεις')
  const provenance: NormalizedProduct['extractionMetadata']['provenance'] = []
  const warnings: string[] = []
  const record = <T>(field: string, value: T, source: string, confidence: 'high' | 'medium' | 'low') => {
    if (value !== null && value !== undefined && value !== '') provenance.push({ field, value, source, confidence })
    return value
  }
  const name = record('name', nameFrom(snapshot, product), 'DOM product heading', 'high')
  const sourceProductCode = record('sourceProductCode', (snapshot.text.match(/Κωδικός προϊόντος\s*:\s*([\w-]+)/i) || [])[1] || (typeof product?.sku === 'string' ? product.sku : null), product?.sku ? 'JSON-LD Product schema' : 'visible text fallback', product?.sku ? 'high' : 'medium')
  const price = record('basePrice', parseNumber(typeof offer?.price === 'string' || typeof offer?.price === 'number' ? String(offer.price) : (snapshot.text.match(/([0-9][0-9.,]*)\s*€/)?.[1])), offer?.price !== undefined ? 'JSON-LD Offer' : 'visible text fallback', offer?.price !== undefined ? 'high' : 'medium')
  const currency = record('currency', typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : snapshot.text.includes('€') ? 'EUR' : null, offer?.priceCurrency ? 'JSON-LD Offer' : 'visible text fallback', offer?.priceCurrency ? 'high' : 'medium')
  const availability = record('availabilityStatus', /διαθέσιμο/i.test(snapshot.text) ? 'Διαθέσιμο' : typeof offer?.availability === 'string' ? offer.availability.split('/').pop() || null : null, /διαθέσιμο/i.test(snapshot.text) ? 'visible text' : 'JSON-LD Offer', 'high')
  const descriptionSection = section(snapshot.text, 'Περιγραφή', 'Τεχνικά Χαρακτηριστικά')
  const description = record('description', descriptionSection.replace(/^Περιγραφή\s*/i, '').trim() || (typeof product?.description === 'string' ? product.description : null), descriptionSection.trim() ? 'visible text description' : 'JSON-LD Product schema', 'high')
  const length = record('dimensionsCm.length', labelNumber(dimensions, 'Μήκος'), 'technical-specifications', 'high')
  const depth = record('dimensionsCm.depth', labelNumber(dimensions, 'Βάθος'), 'technical-specifications', 'high')
  const cornerDepth = record('dimensionsCm.cornerDepth', labelNumber(dimensions, 'Βάθος γωνίας'), 'technical-specifications', 'high')
  const height = record('dimensionsCm.height', labelNumber(dimensions, 'Ύψος'), 'technical-specifications', 'high')
  const seatHeight = record('dimensionsCm.seatHeight', labelNumber(dimensions, 'Ύψος καθίσματος'), 'technical-specifications', 'high')
  const feetHeight = record('dimensionsCm.feetHeight', labelNumber(dimensions, 'Ύψος ποδιών'), 'technical-specifications', 'high')
  const bed = dimensions.match(/Διαστάσεις κρεβατιού\s*:?\s*([0-9]+)\s*x\s*([0-9]+)/i)
  const bedWidth = record('dimensionsCm.bedWidth', parseNumber(bed?.[1]), 'technical-specifications', 'high')
  const bedLength = record('dimensionsCm.bedLength', parseNumber(bed?.[2]), 'technical-specifications', 'high')
  const frame = record('materials.frame', labelText(materials, 'Σκελετός'), 'technical-specifications', 'high')
  const seat = record('materials.seat', labelText(materials, 'Κάθισμα'), 'technical-specifications', 'high')
  const upholstery = record('materials.upholstery', labelText(materials, 'Επένδυση'), 'technical-specifications', 'high')
  const feet = record('materials.feet', labelText(materials, 'Πόδια'), 'technical-specifications', 'high')
  const packageCount = record('packageCount', labelNumber(notes, 'Αριθμός πακέτων'), 'technical-specifications', 'high')
  const weightKg = record('weightKg', labelNumber(notes, 'Συνολικό βάρος'), 'technical-specifications', 'high')
  const packageText = labelText(notes, 'Συσκευασία')
  const packageDimensions = packageText ? [...packageText.matchAll(/([0-9]+)\s*x\s*([0-9]+)\s*x\s*([0-9]+)/gi)].map((match) => ({ length: Number(match[1]), width: Number(match[2]), height: Number(match[3]) })) : []
  if (!name) warnings.push('Product name could not be extracted.')
  if (!sourceProductCode) warnings.push('SKU/product code could not be extracted.')
  if (price === null) warnings.push('Price could not be extracted; no value was invented.')
  if (length === null || (cornerDepth === null && depth === null) || height === null) warnings.push('One or more main dimensions are missing.')
  if (depth !== null && cornerDepth !== null) warnings.push('Generic depth and corner depth are preserved as separate fields.')
  const stableName = name || (typeof product?.name === 'string' ? product.name : null)
  const baseKey = /vancouver/i.test(stableName || '') ? 'vancouver' : keyPart(stableName || snapshot.url.split('/').pop() || sourceProductCode || 'product')
  const productId = `polihome-${baseKey}-${sourceProductCode || keyPart(snapshot.url)}`
  const controls = snapshot.variantControls.filter((control, index, values) => control.sourceVariantName && values.findIndex((candidate) => candidate.sourceVariantName === control.sourceVariantName) === index)
  if (controls.length < 2) warnings.push(`Only ${controls.length} variant(s) were detected; review the source page manually.`)
  const variants = controls.map((control) => {
    const state = stateImages(snapshot, control.sourceVariantName, baseKey)
    const stateSnapshot = snapshot.variantStates.find((candidate) => candidate.sourceVariantName === control.sourceVariantName)
    const stateOffer = stateSnapshot ? offerFrom(stateSnapshot) : offer
    const stateAvailability = stateSnapshot && /διαθέσιμο/i.test(stateSnapshot.text) ? 'Διαθέσιμο' : availability
    return {
      id: state.id,
      productId,
      sourceVariantName: control.sourceVariantName,
      normalizedVariantName: normalizedVariantName(control.sourceVariantName),
      colorName: variantColor(control.sourceVariantName),
      materialName: upholstery,
      sourceImageUrls: state.urls,
      localImagePaths: [],
      materialReference: state.id.endsWith('light') ? 'generated-dominant-colour-light-grey' : 'generated-dominant-colour-dark-grey',
      modelAssetId: null,
      sourceAvailability: stateAvailability,
      sourcePrice: parseNumber(stateOffer?.price !== undefined ? String(stateOffer.price) : '') ?? price,
      extractionWarnings: [],
    }
  })
  const sourceImages = makeSourceImages(snapshot, controls, baseKey)
  variants.forEach((variant) => sourceImages.forEach((image) => {
    if (variant.sourceImageUrls.includes(image.sourceUrl)) image.variantId = variant.id
  }))
  const now = new Date().toISOString()
  return {
    id: productId,
    retailerId: 'polihome',
    sourceUrl: snapshot.url,
    sourceProductCode,
    name,
    localizedNames: { el: name || '', en: /vancouver/i.test(stableName || '') ? 'Vancouver corner sofa' : stableName || 'Polihome product' },
    brand: typeof product?.brand === 'object' && product.brand && typeof (product.brand as Record<string, unknown>).name === 'string' ? (product.brand as Record<string, unknown>).name as string : null,
    category: /γωνιακ|corner\s+sofa/i.test(`${stableName || ''} ${snapshot.text}`) ? 'corner-sofa' : 'unclassified',
    description,
    currency,
    basePrice: price,
    availabilityStatus: availability,
    dimensionsCm: { length, width: null, depth, height, cornerDepth, seatHeight, feetHeight, bedLength, bedWidth },
    materials: { frame, seat, upholstery, feet },
    packageCount,
    weightKg,
    packageDimensions,
    variants,
    sourceImages,
    modelAssets: [],
    extractionMetadata: {
      extractedAt: now,
      extractor: 'polihome-product-page-v1',
      pageTitle: snapshot.title,
      canonicalUrl: snapshot.canonicalUrl,
      provenance,
      warnings,
      sourceStrategies: ['JSON-LD Product schema', 'variant controls', 'technical-specifications', 'product gallery', 'visible text fallback'],
    },
    validationStatus: warnings.some((warning) => /could not|missing|only .*variant/i.test(warning)) ? 'warnings' : 'source-extracted',
    createdAt: now,
    updatedAt: now,
  }
}

export { productSchema }
