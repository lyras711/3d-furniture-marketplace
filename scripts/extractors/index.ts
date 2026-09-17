import type { Page } from '@playwright/test'
import { capturePolihomePage, extractPolihome } from './polihome'
import type { NormalizedProduct, PageSnapshot } from '../product-types'

export interface RetailerExtractor {
  id: string
  canHandle: (url: string) => boolean
  capture: (page: Page) => Promise<PageSnapshot>
  extract: (snapshot: PageSnapshot) => NormalizedProduct
}

export const retailerExtractors: RetailerExtractor[] = [
  { id: 'polihome', canHandle: (url) => new URL(url).hostname.endsWith('polihome.gr'), capture: capturePolihomePage, extract: extractPolihome },
]

export function extractorFor(url: string) {
  const extractor = retailerExtractors.find((candidate) => candidate.canHandle(url))
  if (!extractor) throw new Error(`No retailer extractor is registered for ${new URL(url).hostname}.`)
  return extractor
}
