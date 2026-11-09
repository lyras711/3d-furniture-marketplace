import { useMemo, useState } from 'react'
import type { Product } from './catalog'
import { formatPrice, Icon, ProductThumb } from './ui'

export type AddRoom = 'living' | 'bedroom' | 'dining' | 'kitchen' | 'bathroom' | 'wall' | 'own'
const rooms: { id: AddRoom; label: string }[] = [
  { id: 'living', label: 'Living room' }, { id: 'bedroom', label: 'Bedroom' }, { id: 'dining', label: 'Dining' },
  { id: 'kitchen', label: 'Kitchen' }, { id: 'bathroom', label: 'Bathroom' }, { id: 'wall', label: 'Wall decor' }, { id: 'own', label: 'Your own' },
]
const roomByCategory: Record<string, AddRoom> = {
  Bed: 'bedroom', Nightstand: 'bedroom', Wardrobe: 'bedroom',
  'Dining table': 'dining', 'Dining chair': 'dining',
  'Kitchen counter': 'kitchen', 'Kitchen island': 'kitchen', Refrigerator: 'kitchen', 'Wall cabinet': 'kitchen',
  Toilet: 'bathroom', Shower: 'bathroom', Bathtub: 'bathroom', 'Bathroom vanity': 'bathroom',
}
const roomByGroup: Partial<Record<Product['group'], AddRoom>> = { Bedroom: 'bedroom', Kitchen: 'kitchen', Bathroom: 'bathroom' }
export const productRoom = (product: Product): AddRoom => roomByCategory[product.category] ?? (product.mount === 'wall' ? 'wall' : roomByGroup[product.group] ?? 'living')

export default function AddItemSheet({ products, placedCounts, onAdd, onOwnItem, onClose, initialRoom = 'living' }: {
  products: Product[]; placedCounts: Map<string, number>
  onAdd: (productId: string) => void; onOwnItem: () => void; onClose: () => void; initialRoom?: AddRoom
}) {
  const [room, setRoom] = useState<AddRoom>(initialRoom)
  // Opened from a tapped wall: show only things that hang on a wall.
  const wallOnly = initialRoom === 'wall'
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const list = useMemo(() => searching && term
    ? products.filter((product) => `${product.name} ${product.category} ${product.brand}`.toLowerCase().includes(term))
    : products.filter((product) => room === 'wall' ? product.mount === 'wall' : productRoom(product) === room), [products, room, searching, term])
  return <section className="add-sheet" aria-label="Add furniture">
    <div className="add-sheet-header">
      <h2>Add furniture</h2>
      <button type="button" className="add-sheet-icon" aria-label={searching ? 'Close search' : 'Search furniture'} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery('') }}><Icon name={searching ? 'close' : 'search'} size={20} /></button>
      <button type="button" className="add-sheet-icon" aria-label="Close add furniture" onClick={onClose}><Icon name="chevron" size={22} /></button>
    </div>
    {searching
      ? <label className="add-search"><Icon name="search" size={18} /><input autoFocus aria-label="Search products" placeholder="Sofa, bed, table…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      : <div className="add-tabs" role="group" aria-label="Rooms">{rooms.filter((item) => !wallOnly || item.id === 'wall' || item.id === 'own').map((item) => <button key={item.id} type="button" aria-pressed={room === item.id} className={room === item.id ? 'add-tab-active' : ''} onClick={() => setRoom(item.id)}>{item.label}</button>)}</div>}
    <div className="add-sheet-body">
      {!searching && room === 'own' ? <div className="add-own">
        <strong>Keeping something you already own?</strong>
        <span>Type its size and it appears in your room as a simple block. It is never added to the basket.</span>
        <button type="button" className="primary-button" onClick={onOwnItem}><Icon name="plus" /> Add something you own</button>
      </div> : list.length ? <div className="add-grid">{list.map((product) => <button key={product.id} type="button" className="add-card" title={`Add ${product.name} to room`} onClick={() => onAdd(product.id)}>
        <ProductThumb product={product} />
        {placedCounts.get(product.id) ? <span className="placed-badge">{placedCounts.get(product.id)} in room</span> : null}
        <strong>{product.name}</strong>
        <small>{product.width} × {product.depth} cm</small>
        <span className="add-card-price">{formatPrice(product.price)}</span>
      </button>)}</div> : <p className="add-empty">{searching ? 'Nothing matches that search yet.' : 'No pieces for this room yet.'}</p>}
    </div>
  </section>
}
