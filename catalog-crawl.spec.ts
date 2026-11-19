import { expect, test } from '@playwright/test'
import { isProductPageHtml, validatePublicUrl } from './scripts/catalog-workflow'
import { captureMetadata, isProductName, metadataProductBelongsToCrawl, metadataProductId, parseDimensions, parsePrice, productGroupFor, safeProduct, type MetadataCrawlJob } from './scripts/catalog-metadata-crawl'
import { validateGlb, validateTexture } from './scripts/catalog-asset'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { cloneProductScene } from './src/productScene'

test('metadata crawl assigns distinct catalogue ids to Greek product names without SKUs', () => {
  const names = ['Καναπές Αθήνα', 'Καναπές Βόλος', 'Καναπές Modern Αθήνα', 'Καναπές Modern Βόλος', 'Καρέκλα Κόρινθος', 'Καρέκλα Λάρισα', 'Τραπέζι Μήλος', 'Τραπέζι Νάξος', 'Κρεβάτι Ξάνθη', 'Φωτιστικό Πάτρα']
  const ids = names.map((name, index) => metadataProductId('polihome', null, name, `https://www.polihome.gr/el/products/item-${index + 1}`))
  expect(new Set(ids).size).toBe(names.length)
})

test('metadata deletion only removes products owned by the selected crawl', () => {
  const product = { importedBy: 'metadata-crawl' }
  expect(metadataProductBelongsToCrawl(product, { importedFromCrawlId: 'crawl-1' }, 'crawl-1')).toBe(true)
  expect(metadataProductBelongsToCrawl(product, { importedFromCrawlId: 'crawl-2' }, 'crawl-1')).toBe(false)
  expect(metadataProductBelongsToCrawl(product, {}, 'crawl-1')).toBe(false)
  expect(metadataProductBelongsToCrawl({ importedBy: 'other' }, { importedFromCrawlId: 'crawl-1' }, 'crawl-1')).toBe(false)
})

test('metadata crawl rejects a retailer name used as the product name', () => {
  expect(isProductName('Polihome', 'Polihome')).toBe(false)
  expect(isProductName('Καναπές Αθήνα', 'Polihome')).toBe(true)
})

test('catalog discovery distinguishes product pages from product categories', () => {
  expect(isProductPageHtml('<h1>Καναπέδες</h1><meta property="og:type" content="website">')).toBe(false)
  expect(isProductPageHtml('<h1>Καναπέδες</h1><div itemscope itemtype="https://schema.org/Product"><h2 itemprop="name">Moon sofa</h2><span itemprop="price">690</span></div>')).toBe(false)
  expect(isProductPageHtml('<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Moon sofa</h1><span itemprop="price">690</span></div>')).toBe(true)
})

test('metadata extraction does not use a retailer page title as a product name', async ({ page }) => {
  await page.setContent('<html><head><title>Polihome</title></head><body></body></html>')
  const product = await page.evaluate(captureMetadata) as { name: string }
  expect(product.name).toBe('')
})

test('metadata extraction includes product images declared in JSON-LD', async ({ page }) => {
  const schema = JSON.stringify({ '@type': 'Product', name: 'Καρέκλα Αθήνα', image: ['https://cdn.example.com/chair.jpg'] })
  await page.setContent(`<script type="application/ld+json">${schema}</script><p>Κωδικός προϊόντος: 162597339</p>`)
  const product = await page.evaluate(captureMetadata) as { images: { url: string }[]; sku: string }
  expect(product.images.map((image: { url: string }) => image.url)).toContain('https://cdn.example.com/chair.jpg')
  expect(product.sku).toBe('162597339')
})

test('metadata extraction reads schema.org microdata on product pages', async ({ page }) => {
  await page.setContent('<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Moon sofa</h1><meta itemprop="sku" content="842"><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><span itemprop="price">690</span><span itemprop="priceCurrency">EUR</span><span itemprop="availability">InStock</span></div><p itemprop="description">A comfortable corner sofa.</p><table class="data-table"><tr><td class="data-label">Διάσταση</td><td>250x180x100</td></tr></table><a href="/products/sofas/">ΕΠΙΣΤΡΟΦΗ: Sofas</a><img itemprop="image" src="https://cdn.example.com/moon.jpg"></div><img src="https://cdn.example.com/recommended.jpg">')
  const product = await page.evaluate(captureMetadata) as { name: string; sku: string; category: string; price: number; currency: string; availability: string; description: string; attributes: { label: string; value: string }[]; images: { url: string }[] }
  expect(product).toMatchObject({ name: 'Moon sofa', sku: '842', category: 'Sofas', currency: 'EUR', availability: 'InStock', description: 'A comfortable corner sofa.' })
  expect(product.attributes).toContainEqual({ label: 'Διάσταση', value: '250x180x100' })
  expect(product.images.map((image: { url: string }) => image.url)).toEqual(['https://cdn.example.com/moon.jpg'])
  const job: MetadataCrawlJob = { id: 'job', brandName: 'Galanis In House', retailerId: 'galanis-in-house', website: 'https://galanis-inhouse.gr', maxProducts: 1, delayMs: 1000, status: 'running', discoveredUrls: [], items: [], currentUrl: null, error: null, createdAt: '', updatedAt: '' }
  const storedImage = 'https://storage.example.com/moon.webp'
  const draft = safeProduct(product, job, 'https://galanis-inhouse.gr/products/842-moon/', [{ url: storedImage, sourceUrl: product.images[0].url, role: 'hero', altText: null, width: null, height: null }], [storedImage])
  expect(draft).toMatchObject({ name: 'Moon sofa', sku: '842', category: 'Sofas', group: 'Seating', price: 690, width: 250, depth: 180, height: 100, thumbnailPath: storedImage })
  expect(draft.metadata?.missingFields).toEqual([])
})

test('catalog crawl accepts only public HTTPS hosts and stays on the submitted host', async () => {
  await expect(validatePublicUrl('http://example.com')).rejects.toThrow('public HTTPS')
  await expect(validatePublicUrl('https://127.0.0.1')).rejects.toThrow('public IP')
  await expect(validatePublicUrl('https://10.0.0.8')).rejects.toThrow('public IP')
  await expect(validatePublicUrl('https://www.example.com', 'example.com')).rejects.toThrow('outside the brand website')
})

test('GLB uploads must contain a valid version 2 JSON chunk', () => {
  const payload = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }))
  const padded = Buffer.concat([payload, Buffer.alloc((4 - payload.length % 4) % 4, 0x20)])
  const glb = Buffer.alloc(20 + padded.length)
  glb.write('glTF', 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20)
  expect(validateGlb(glb.toString('base64'))).toEqual(glb)
  expect(() => validateGlb(Buffer.from('invalid').toString('base64'))).toThrow('GLB file is invalid')
})

test('variant texture uploads validate the image type and file signature', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
  expect(validateTexture(png.toString('base64'), 'image/png').ext).toBe('png')
  expect(() => validateTexture(png.toString('base64'), 'image/jpeg')).toThrow('Texture is invalid')
  expect(() => validateTexture(png.toString('base64'), 'image/svg+xml')).toThrow('PNG, JPEG, or WebP')
})

test('variant textures replace only the selected cloned GLB material', () => {
  const source = new Group(), fabric = new MeshStandardMaterial(), metal = new MeshStandardMaterial()
  fabric.name = 'Fabric Seat'; metal.name = 'Metal Frame'
  source.add(new Mesh(new BoxGeometry(), fabric), new Mesh(new BoxGeometry(), metal))
  const texture = new Texture(), clone = cloneProductScene(source, '#ff0000', texture, 'Fabric Seat')
  const clonedFabric = (clone.children[0] as Mesh).material as MeshStandardMaterial
  const clonedMetal = (clone.children[1] as Mesh).material as MeshStandardMaterial
  expect(clonedFabric).not.toBe(fabric)
  expect(clonedFabric.map).toBe(texture)
  expect(clonedFabric.color.getHexString()).toBe('ffffff')
  expect(clonedMetal.color.getHexString()).toBe('ffffff')
  expect(fabric.map).toBeNull()
})

const crawlJob = (brandName: string): MetadataCrawlJob => ({ id: 'job', brandName, retailerId: brandName.toLowerCase(), website: 'https://shop.example', maxProducts: 1, delayMs: 1000, status: 'running', discoveredUrls: [], items: [], currentUrl: null, error: null, createdAt: '', updatedAt: '' })

test('metadata prices parse Greek and English thousands separators', () => {
  expect(parsePrice('1.690 €')).toBe(1690)
  expect(parsePrice('1.389,00 €')).toBe(1389)
  expect(parsePrice('619,00 €')).toBe(619)
  expect(parsePrice('1,690.50')).toBe(1690.5)
  expect(parsePrice('1690.00')).toBe(1690)
  expect(parsePrice(479)).toBe(479)
  expect(parsePrice('Τιμή κατόπιν συνεννόησης')).toBeNull()
})

test('metadata dimensions read labelled, multiplied, metre and millimetre text', () => {
  expect(parseDimensions(['Διαστάσεις: 200 x 90 x 85 εκ.'])).toMatchObject({ width: 200, depth: 90, height: 85 })
  expect(parseDimensions(['Μήκος: 92', 'Βάθος: 48', 'Ύψος: 218'])).toMatchObject({ width: 92, depth: 48, height: 218 })
  expect(parseDimensions(['Π: 220 Β: 95 Υ: 80 cm'])).toMatchObject({ width: 220, depth: 95, height: 80 })
  expect(parseDimensions(['Διαστάσεις: 1.70 Χ 0.90 cm'])).toMatchObject({ width: 170, depth: 90, height: null })
  expect(parseDimensions(['Dimensions: W2000 x D900 x H850 mm'])).toMatchObject({ width: 200, depth: 90, height: 85 })
  expect(parseDimensions(['καναπές σε σχήμα Π συνολικών εργοστασιακών διαστάσεων 260x370x180 μπορεί'])).toMatchObject({ width: 260, depth: 370, height: 180 })
  expect(parseDimensions(['Χρώμα: γκρι'])).toMatchObject({ width: null, depth: null, height: null, source: null })
})

test('metadata groups follow the leading Greek or English product noun', () => {
  expect(productGroupFor('Καρέκλα τραπεζαρίας Nora')).toBe('Seating')
  expect(productGroupFor('Τραπέζι με 4 καρέκλες')).toBe('Tables')
  expect(productGroupFor('Σύνθετα - έπιπλα TV')).toBe('Storage')
  expect(productGroupFor('Καναπές κρεβάτι Luna')).toBe('Seating')
  expect(productGroupFor('Πολυέλαιος', 'Φωτιστικό οροφής')).toBe('Lighting')
})

test('metadata extraction keeps the product gallery and ignores menus and related products', async ({ page }) => {
  const breadcrumbs = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Αρχική', item: 'https://shop.example/' }, { '@type': 'ListItem', position: 2, name: 'Καναπέδες', item: 'https://shop.example/c/sofas' }, { '@type': 'ListItem', position: 3, name: 'Γωνιακοί καναπέδες', item: 'https://shop.example/c/corner' }, { '@type': 'ListItem', position: 4, name: 'Γωνιακός καναπές Orion' }] })
  await page.setContent(`<script type="application/ld+json">${breadcrumbs}</script>
    <header><nav class="menu"><img src="https://shop.example/media/menu-sofas.jpg" width="600"></nav></header>
    <main><div class="product type-product">
      <div class="woocommerce-product-gallery"><div class="woocommerce-product-gallery__image" data-thumb="https://shop.example/media/orion-100x100.jpg"><a href="https://shop.example/media/orion.jpg"><img src="https://shop.example/media/orion-600x600.jpg" data-large_image="https://shop.example/media/orion.jpg"></a></div>
      <div class="woocommerce-product-gallery__image"><a href="https://shop.example/media/orion-side.jpg"><img src="https://shop.example/media/orion-side-600x600.jpg" data-large_image="https://shop.example/media/orion-side.jpg"></a></div></div>
      <div class="summary"><h1 class="product_title">Γωνιακός καναπές Orion</h1><p class="price"><del><span class="woocommerce-Price-amount">1.950,00 €</span></del> <ins><span class="woocommerce-Price-amount amount">1.690,00 €</span></ins></p>
      <div class="product_meta"><span class="sku_wrapper">Κωδικός: <span class="sku">OR-240</span></span></div></div>
      <div id="tab-description"><p>Άνετος γωνιακός καναπές με αδιάβροχο ύφασμα και ανθεκτικό σκελετό από ξύλο οξιάς.</p></div>
      <table class="woocommerce-product-attributes"><tr><th>Διαστάσεις</th><td>240 x 180 x 85 εκ.</td></tr><tr><th>Ύφασμα</th><td>Βελουτέ</td></tr><tr><th>Βάρος</th><td>65 kg</td></tr></table>
      <section class="related products"><ul class="products"><li><a href="https://shop.example/product/nova"><img src="https://shop.example/media/nova-600x600.jpg" width="600"></a></li></ul></section>
    </div></main>`)
  const raw = await page.evaluate(captureMetadata) as Record<string, unknown> & { images: { url: string }[] }
  expect(raw.images.map((image) => image.url)).toEqual(['https://shop.example/media/orion.jpg', 'https://shop.example/media/orion-side.jpg'])
  const stored = raw.images.map((image, index) => ({ url: `https://storage.example/${index}.jpg`, sourceUrl: image.url, role: index ? 'gallery' : 'hero', altText: null, width: null, height: null }))
  const draft = safeProduct(raw, crawlJob('Shop'), 'https://shop.example/product/orion', stored, stored.map((image) => image.url))
  expect(draft).toMatchObject({ name: 'Γωνιακός καναπές Orion', sku: 'OR-240', price: 1690, category: 'Γωνιακοί καναπέδες', group: 'Seating', width: 240, depth: 180, height: 85, thumbnailPath: 'https://storage.example/0.jpg' })
  expect(draft.metadata).toMatchObject({ weightKg: 65, materials: { 'Ύφασμα': 'Βελουτέ' }, missingFields: [] })
  expect(draft.metadata?.description).toContain('ξύλο οξιάς')
  expect(draft.metadata?.fieldSources.sku).toMatchObject({ source: 'page sku', confidence: 'high' })
})
