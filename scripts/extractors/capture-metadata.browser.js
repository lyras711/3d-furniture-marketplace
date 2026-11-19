(() => {
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  const plain = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const absoluteUrl = (value) => { try { return value ? new URL(String(value).trim(), location.href).href : '' } catch { return '' } }
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || ''
  const list = (value) => value == null ? [] : Array.isArray(value) ? value : [value]
  const types = (value) => list(value?.['@type']).map((type) => String(type).toLowerCase())

  const parseJson = (node) => { try { return list(JSON.parse(node.textContent || 'null')) } catch { return [] } }
  const flatten = (values, depth = 0) => depth > 4 ? [] : values.flatMap((value) => value && typeof value === 'object'
    ? [value, ...flatten([...list(value['@graph']), ...list(value.mainEntity), ...list(value.mainEntityOfPage).filter((item) => typeof item === 'object')], depth + 1)]
    : [])
  const nodes = flatten([...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(parseJson))
  const productGroup = nodes.find((value) => types(value).includes('productgroup')) || null
  const variants = list(productGroup?.hasVariant).filter((value) => value && typeof value === 'object')
  const product = nodes.find((value) => types(value).includes('product')) || variants[0] || productGroup || {}

  const productNodes = [...document.querySelectorAll('[itemscope][itemtype]')].filter((node) => /schema\.org\/product$/i.test(node.getAttribute('itemtype') || ''))
  const productNode = productNodes.find((node) => node.querySelector('h1[itemprop="name"]')) || (productNodes.length === 1 && !productNodes[0].closest('a[href]') ? productNodes[0] : null)
  const property = (scope, name) => scope ? [...scope.querySelectorAll('[itemprop="' + name + '"]')].find((node) => node.parentElement?.closest('[itemscope]') === scope) || null : null
  const valueOf = (node) => node?.getAttribute('content') || node?.getAttribute('href') || node?.getAttribute('src') || clean(node?.textContent)
  const productValue = (name) => valueOf(property(productNode, name))
  const offerNode = property(productNode, 'offers')
  const offerValue = (name) => valueOf(property(offerNode, name))

  const excluded = 'header, nav, footer, aside, [role="navigation"], [class*="menu"], [class*="related"], [class*="upsell"], [class*="cross-sell"], [class*="crosssell"], [class*="recent"], [class*="similar"], [class*="recommend"], [class*="also-like"], .products, [class*="cookie"], [class*="newsletter"], [class*="breadcrumb"], [class*="footer"], [class*="header"], [class*="minicart"], [class*="mini-cart"]'
  const isExcluded = (element) => {
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node === productNode) return false
      if (node.matches?.(excluded)) return true
    }
    return false
  }
  const scope = productNode
    || document.querySelector('.product.type-product, [class*="single-product"]:not(body), [class*="product-detail"], [class*="product-page"], [class*="productDetail"], [class*="product-view"], main, [role="main"]')
    || document.body

  const nameCandidates = [
    ...[...document.querySelectorAll('h1')].filter((node) => !isExcluded(node)).map((node) => clean(node.textContent)),
    clean(product.name), clean(productValue('name')), clean(productGroup?.name),
    clean(meta('meta[property="og:title"]')),
  ].filter(Boolean).map((value) => value.slice(0, 200))

  const visibleText = (document.body?.innerText || '').slice(0, 200000)
  const plainText = visibleText.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const skuCandidates = [
    ['json-ld sku', product.sku], ['json-ld mpn', product.mpn], ['json-ld productID', product.productID], ['json-ld gtin', product.gtin13 || product.gtin || product.gtin14 || product.gtin8],
    ['microdata sku', productValue('sku')], ['microdata productID', productValue('productID')],
    ['page sku', document.querySelector('.sku, [class*="product-sku"], [class*="product-code"], [data-sku]')?.getAttribute('data-sku') || document.querySelector('.sku, [class*="product-sku"], [class*="product-code"]')?.textContent],
    ['meta retailer id', meta('meta[property="product:retailer_item_id"]')],
    ['page text', plainText.match(/(?:sku|κωδικος(?:\s+προιοντος)?|κωδ\.|product\s*(?:code|id|no\.?)|item\s*(?:code|no\.?)|art(?:icle)?\.?\s*no\.?|code)\s*[:#.]?\s*([a-z0-9][a-z0-9._/-]{1,40})/i)?.[1]],
  ].map(([source, value]) => [source, clean(String(value ?? '')).replace(/^(?:sku|κωδικός|code)\s*[:#]?\s*/i, '')]).filter(([, value]) => value && /[0-9a-z]/i.test(value) && value.length <= 60)
  const urlSlug = new URL(location.href).pathname.split('/').filter(Boolean).pop() || ''
  const skuFromUrl = urlSlug.match(/^(\d+)(?:-|$)|(?:^|-)(\d+)$/)
  if (skuFromUrl) skuCandidates.push(['product URL number', skuFromUrl[1] || skuFromUrl[2]])

  const offers = list(product.offers).flatMap((offer) => [offer, ...list(offer?.offers)]).filter((offer) => offer && typeof offer === 'object')
  const offer = offers[0] || {}
  const priceSelectors = ['[itemprop="price"]', '.summary .price ins .amount', '.price ins .amount', '.summary .price .amount', '.woocommerce-Price-amount', '[class*="final-price"]', '[class*="current-price"]', '[class*="sale-price"]', '[class*="special-price"]', '[class*="product-price"]', '[class*="price"]']
  const priceText = (node) => {
    const copy = node.cloneNode(true)
    copy.querySelectorAll('del, s, [class*="old"], [class*="regular"], [class*="was"], [class*="before"]').forEach((item) => item.remove())
    return node.getAttribute('content') || clean(copy.textContent)
  }
  const priceElement = priceSelectors.map((selector) => [...scope.querySelectorAll(selector)]
    .find((node) => !isExcluded(node) && !node.closest('del, s, [class*="old"], [class*="regular"], [class*="was"], [class*="before"]') && /\d/.test(priceText(node)))).find(Boolean)
  const priceCandidates = [
    ['json-ld offer', offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price],
    ['microdata offer', offerValue('price') || productValue('price')],
    ['meta price', meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]')],
    ['page price', priceElement ? priceText(priceElement) : ''],
  ].filter(([, value]) => value !== '' && value != null && /\d/.test(String(value)))

  const crumbUrl = (value) => absoluteUrl(typeof value === 'string' ? value : value?.['@id'] || value?.url || '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const here = location.href.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const crumbLists = nodes.filter((value) => types(value).includes('breadcrumblist')).map((node) => list(node.itemListElement)
    .sort((left, right) => Number(left?.position || 0) - Number(right?.position || 0))
    .filter((item) => crumbUrl(item?.item) !== here)
    .map((item) => clean(item?.name || item?.item?.name || '')).filter(Boolean))
  const crumbsFromDom = [...document.querySelectorAll('[class*="breadcrumb"] a, [class*="breadcrumb"] li, nav[aria-label*="readcrumb"] a, [itemtype*="BreadcrumbList"] [itemprop="name"]')]
    .map((node) => clean(node.textContent)).filter((value, index, all) => value && value.length < 80 && all.indexOf(value) === index)
  const breadcrumbs = [...crumbLists, crumbsFromDom].sort((left, right) => right.length - left.length)[0] || []
  const isNameCrumb = (crumb) => nameCandidates.some((name) => plain(name).startsWith(plain(crumb)) || plain(crumb).startsWith(plain(name)))
  const backLink = [...document.querySelectorAll('a[href]')].map((link) => clean(link.textContent)).find((text) => /^(?:επιστροφ\S*|back to)\s*(?:σε)?\s*:/i.test(text)) || ''
  const postedIn = [...document.querySelectorAll('.posted_in a, [class*="product-category"] a')].map((node) => clean(node.textContent)).filter(Boolean)
  const categoryCandidates = [
    ...list(product.category).map((value) => clean(typeof value === 'object' ? value?.name : String(value).split('>').pop())),
    clean(productValue('category')),
    backLink ? clean(backLink.slice(backLink.indexOf(':') + 1)) : '',
    breadcrumbs.length > 1 ? breadcrumbs.slice(1).filter((crumb) => !isNameCrumb(crumb)).at(-1) || '' : '',
    postedIn[0] || '',
  ].filter(Boolean)

  const attributes = []
  const addAttribute = (label, value) => {
    label = clean(label).replace(/[:：]\s*$/, ''); value = clean(value)
    if (!label || !value || label.length > 80 || value.length > 600 || label === value) return
    if (!attributes.some((item) => item.label === label && item.value === value)) attributes.push({ label: label.slice(0, 200), value: value.slice(0, 500) })
  }
  for (const row of scope.querySelectorAll('tr')) {
    if (isExcluded(row)) continue
    const labelNode = row.querySelector('th, .data-label, td[data-label]')
    const cells = [...row.querySelectorAll('td')]
    const label = labelNode ? labelNode.textContent || labelNode.getAttribute('data-label') : cells.length === 2 ? cells[0].textContent : ''
    const valueCell = cells.find((cell) => cell !== labelNode && (labelNode || cell !== cells[0]))
    addAttribute(label, valueCell?.textContent)
  }
  for (const term of scope.querySelectorAll('dt')) {
    if (isExcluded(term)) continue
    const description = term.nextElementSibling?.tagName === 'DD' ? term.nextElementSibling : null
    addAttribute(term.textContent, description?.textContent)
  }
  for (const node of scope.querySelectorAll('li, p, [class*="spec"] div, [class*="attribute"] div, [class*="feature"] div')) {
    if (isExcluded(node) || node.children.length > 4) continue
    const text = clean(node.textContent)
    const match = text.match(/^([^:：]{2,40})[:：]\s*(.{1,300})$/)
    if (match && !/https?$/i.test(match[1])) addAttribute(match[1], match[2])
  }
  for (const property of list(product.additionalProperty)) addAttribute(property?.name, property?.value ?? property?.description)

  const descriptionCandidates = [
    clean(product.description), clean(productValue('description')),
    ...[...scope.querySelectorAll('#tab-description, .woocommerce-product-details__short-description, [class*="product-description"], [class*="product__description"], [class*="description"], [itemprop="description"]')]
      .filter((node) => !isExcluded(node)).map((node) => clean(node.innerText || node.textContent)),
  ].filter((value) => value.length > 20)
  const description = (descriptionCandidates.sort((left, right) => right.length - left.length)[0] || clean(meta('meta[property="og:description"]') || meta('meta[name="description"]'))).slice(0, 4000)

  const dimensionKeyword = /διαστασ|dimension|size|μεγεθ|πλατος|βαθος|υψος|μηκος|width|depth|height|length|\d\s*(?:cm|εκ|mm)?\s*[x×χ*]\s*\d/i
  const scopeLines = (scope.innerText || '').split(/\n+/).map(clean).filter((line) => line.length < 300 && dimensionKeyword.test(plain(line)) && !/€|eur\b/i.test(line))
  const descriptionSentences = description.split(/(?<=[.!;])\s+/).filter((line) => dimensionKeyword.test(plain(line)))
  const dimensionTexts = [...new Set([...scopeLines, ...descriptionSentences])].slice(0, 40)

  const imageKeyword = /logo|icon|sprite|avatar|placeholder|flag|badge|payment|banner|loader|spinner|blank\.|pixel|rating|star|social|whatsapp|facebook|instagram|viber|cookie/i
  const largestSrcset = (value) => (value || '').split(',').map((part) => part.trim().split(/\s+/)).map(([url, size]) => ({ url, size: parseFloat(size) || 0 })).sort((left, right) => right.size - left.size)[0]?.url || ''
  const elementImageUrl = (element) => element.getAttribute('data-large_image') || element.getAttribute('data-zoom-image') || element.getAttribute('data-full') || element.getAttribute('data-full-src') || element.getAttribute('data-image') || element.getAttribute('data-src') || element.getAttribute('data-lazy-src') || element.getAttribute('data-original') || largestSrcset(element.getAttribute('data-srcset') || element.getAttribute('srcset')) || element.currentSrc || element.getAttribute('src') || element.getAttribute('content') || (element.tagName === 'A' ? element.getAttribute('href') : '')
  const linksElsewhere = (element) => {
    const link = element.closest('a[href]')
    if (!link) return false
    const href = absoluteUrl(link.getAttribute('href'))
    if (!href || /\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(href)) return false
    const target = new URL(href)
    return target.pathname !== location.pathname || target.hostname !== location.hostname
  }
  const images = [], seenImages = new Set()
  const addImage = (url, altText = '', width = null, height = null, source = 'page') => {
    url = absoluteUrl(url)
    if (!/^https?:/i.test(url) || /\.(?:svg|gif)(?:$|\?)/i.test(url) || imageKeyword.test(new URL(url).pathname)) return
    const key = url.replace(/[?#].*$/, '').replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '').replace(/\/(?:thumb|thumbs|small|medium|large|full)\//i, '/')
    if (seenImages.has(key)) return
    seenImages.add(key)
    images.push({ url, altText: clean(altText).slice(0, 200), width: Number(width) || null, height: Number(height) || null, source })
  }
  for (const image of [...list(product.image), ...list(productGroup?.image), ...variants.flatMap((variant) => list(variant.image))]) {
    const source = typeof image === 'string' ? image : image?.url || image?.contentUrl || ''
    addImage(source, typeof image === 'object' ? image?.caption || image?.name : '', image?.width?.value ?? image?.width, image?.height?.value ?? image?.height, 'json-ld')
  }
  for (const node of productNode ? [...productNode.querySelectorAll('[itemprop="image"]')].filter((node) => node.parentElement?.closest('[itemscope]') === productNode) : []) addImage(valueOf(node), node.getAttribute('alt') || '', null, null, 'microdata')
  const og = meta('meta[property="og:image"]') || meta('meta[property="og:image:secure_url"]')
  if (og) addImage(og, '', meta('meta[property="og:image:width"]'), meta('meta[property="og:image:height"]'), 'og:image')
  const gallerySelector = '[data-large_image], [data-zoom-image], .woocommerce-product-gallery__image a[href], .woocommerce-product-gallery img, [class*="gallery"] img, [class*="Gallery"] img, [class*="slider"] img, [class*="carousel"] img, [class*="swiper"] img, [class*="slick"] img, [class*="product-image"] img, [class*="product-img"] img, [class*="productImage"] img, [class*="prd-gal"] img, [class*="media"] img, picture img'
  const galleryNodes = [...scope.querySelectorAll(gallerySelector)].filter((node) => !isExcluded(node) && !linksElsewhere(node))
  const tooSmall = (node) => node.tagName === 'IMG' && node.complete && node.naturalWidth > 0 && node.naturalWidth < 240 && !node.getAttribute('data-large_image') && !node.getAttribute('data-zoom-image')
  for (const node of galleryNodes) if (!tooSmall(node)) addImage(elementImageUrl(node), node.getAttribute('alt') || '', node.naturalWidth || node.getAttribute('width'), node.naturalHeight || node.getAttribute('height'), 'gallery')
  if (images.length < 2) {
    for (const node of scope.querySelectorAll('img')) {
      if (isExcluded(node) || linksElsewhere(node) || tooSmall(node) || node.naturalWidth && node.naturalWidth < 300) continue
      addImage(elementImageUrl(node), node.getAttribute('alt') || '', node.naturalWidth, node.naturalHeight, 'page')
    }
  }

  const brand = typeof product.brand === 'string' ? product.brand : product.brand?.name || productValue('brand') || meta('meta[property="product:brand"]')
  const availability = String(offer.availability || offerValue('availability') || meta('meta[property="product:availability"]') || clean(scope.querySelector('.stock, [class*="availability"], [class*="stock-status"]')?.textContent) || '').split('/').pop()
  const dimension = (key) => {
    const value = product[key] || productValue(key)
    if (!value) return null
    return typeof value === 'object' ? { value: value.value, unit: value.unitCode || value.unitText || '' } : { value, unit: '' }
  }
  return {
    name: nameCandidates[0] || '', nameCandidates: [...new Set(nameCandidates)].slice(0, 8),
    sku: skuCandidates[0]?.[1] || '', skuSource: skuCandidates[0]?.[0] || null, skuCandidates: skuCandidates.slice(0, 8),
    priceCandidates: priceCandidates.map(([source, value]) => [source, typeof value === 'number' ? value : clean(String(value))]),
    currency: offer.priceCurrency || offerValue('priceCurrency') || meta('meta[property="product:price:currency"]') || 'EUR',
    category: categoryCandidates[0] || '',
    categoryCandidates, breadcrumbs: breadcrumbs.slice(0, 10),
    description, availability: clean(availability).slice(0, 80),
    width: dimension('width'), depth: dimension('depth'), height: dimension('height'),
    sourceBrand: clean(brand), pageTitle: document.title, siteName: meta('meta[property="og:site_name"]'),
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null,
    attributes: attributes.slice(0, 80), dimensionTexts, images: images.slice(0, 16),
  }
})()
