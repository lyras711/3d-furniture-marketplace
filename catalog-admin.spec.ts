import { expect, test } from '@playwright/test'
import { applyCatalogMetadataOverrides, catalogAssetPrefixFromUrl, catalogHasDimensions, catalogIsDeleted, catalogIsHidden, parseCatalogArchiveIds, parseCatalogMetadataOverrides, parseCatalogPermanentDeleteIds, parseManualCatalogProduct } from './scripts/catalog-admin'

test('catalog metadata overrides validate and replace only editable fields', () => {
  const source = { id: 'sofa-haven', name: 'Original sofa', width: 220, modelPath: '/model.glb' }
  const overrides = parseCatalogMetadataOverrides({ name: 'Edited sofa', width: 210, sku: null, price: 0 })
  const result = applyCatalogMetadataOverrides(source, overrides)
  expect(result).toMatchObject({ id: 'sofa-haven', name: 'Edited sofa', width: 210, sku: null, price: 0, modelPath: '/model.glb' })
  expect(source).toMatchObject({ name: 'Original sofa', width: 220 })
})

test('catalog metadata overrides reject invalid groups, dimensions and unrelated fields', () => {
  expect(() => parseCatalogMetadataOverrides({ group: 'All' })).toThrow('Choose a valid product group.')
  expect(() => parseCatalogMetadataOverrides({ width: -1 })).toThrow('width must be between 0 and 2000 cm.')
  expect(() => parseCatalogMetadataOverrides({ id: 'different-product' })).toThrow('cannot be edited')
})

test('manual catalog products validate required metadata and optional HTTPS references', () => {
  expect(parseManualCatalogProduct({
    name: 'Studio armchair', brand: 'Formivo', retailer: 'Formivo', group: 'Seating', category: 'Armchairs',
    width: 82, depth: 78, height: 91, price: 240, sku: '', sourceUrl: 'https://formivo3d.com/item',
    thumbnailUrl: 'https://images.example/item.jpg',
  })).toEqual({
    name: 'Studio armchair', brand: 'Formivo', retailer: 'Formivo', group: 'Seating', category: 'Armchairs',
    width: 82, depth: 78, height: 91, price: 240, sku: null, sourceUrl: 'https://formivo3d.com/item',
    thumbnailUrl: 'https://images.example/item.jpg',
  })
  expect(() => parseManualCatalogProduct({
    name: 'Incomplete item', brand: 'Formivo', retailer: 'Formivo', group: 'Seating', category: 'Armchairs',
    width: 82, depth: 0, height: 91,
  })).toThrow('Width, depth, and height must be greater than zero.')
  expect(() => parseManualCatalogProduct({
    name: 'Unsafe image', brand: 'Formivo', retailer: 'Formivo', group: 'Seating', category: 'Armchairs',
    width: 82, depth: 78, height: 91, thumbnailUrl: 'javascript:alert(1)',
  })).toThrow('Thumbnail URL must be a valid HTTPS URL.')
})

test('bulk archive accepts unique safe product ids and rejects invalid selections', () => {
  expect(parseCatalogArchiveIds({ ids: ['sofa-haven', 'table-1', 'sofa-haven'] })).toEqual(['sofa-haven', 'table-1'])
  expect(() => parseCatalogArchiveIds({ ids: [] })).toThrow('Provide between 1 and 500 catalog product ids.')
  expect(() => parseCatalogArchiveIds({ ids: ['sofa/haven'] })).toThrow('Catalog product ids are invalid.')
  expect(() => parseCatalogArchiveIds({ ids: ['sofa-haven'], deleteAssets: true })).toThrow('Provide between 1 and 500 catalog product ids.')
})

test('permanent deletion requires an exact confirmation and unique safe ids', () => {
  expect(parseCatalogPermanentDeleteIds({ ids: ['manual-1'], confirmation: 'DELETE' })).toEqual(['manual-1'])
  expect(() => parseCatalogPermanentDeleteIds({ ids: ['manual-1'], confirmation: 'delete' })).toThrow('Type DELETE')
  expect(() => parseCatalogPermanentDeleteIds({ ids: ['manual-1', 'manual-1'], confirmation: 'DELETE' })).toThrow('unique')
  expect(() => parseCatalogPermanentDeleteIds({ ids: ['manual/1'], confirmation: 'DELETE' })).toThrow('Catalog product ids are invalid.')
  expect(() => parseCatalogPermanentDeleteIds({ ids: Array.from({ length: 251 }, (_, index) => `item-${index}`), confirmation: 'DELETE' })).toThrow('no more than 250')
})

test('catalog asset deletion only accepts owned paths for the selected product and bucket', () => {
  expect(catalogAssetPrefixFromUrl('https://storage.googleapis.com/test-bucket/catalog/polihome/item-1/models/a.glb', 'item-1', 'test-bucket')).toBe('catalog/polihome/item-1/')
  expect(catalogAssetPrefixFromUrl('https://firebasestorage.googleapis.com/v0/b/test-bucket/o/catalog%2Fpolihome%2Fitem-1%2Fcrawls%2Fcrawl%2Fimages%2Fa.jpg?alt=media', 'item-1', 'test-bucket')).toBe('catalog/polihome/item-1/')
  expect(catalogAssetPrefixFromUrl('https://storage.googleapis.com/test-bucket/catalog/polihome/item-2/a.glb', 'item-1', 'test-bucket')).toBeNull()
  expect(catalogAssetPrefixFromUrl('https://images.example/item-1.jpg', 'item-1', 'test-bucket')).toBeNull()
})

test('deleted catalog products stay hidden until their deletion marker is cleared', () => {
  expect(catalogIsDeleted({ deletedAt: '2026-11-20T12:00:00.000Z' })).toBe(true)
  expect(catalogIsHidden({ hidden: false, deletedAt: '2026-11-20T12:00:00.000Z' })).toBe(true)
  expect(catalogIsDeleted({ deletedAt: null })).toBe(false)
  expect(catalogIsHidden({ hidden: false, deletedAt: null })).toBe(false)
})

test('catalog visibility requires finite positive dimensions before listing imported products', () => {
  expect(catalogHasDimensions({ width: 100, depth: 80, height: 50 })).toBe(true)
  expect(catalogHasDimensions({ width: 100, depth: 0, height: 50 })).toBe(false)
  expect(catalogHasDimensions({ width: 100, depth: undefined, height: 50 })).toBe(false)
  expect(catalogHasDimensions({ width: '100', depth: 80, height: 50 })).toBe(false)
})
