import type { Product } from './catalog'

export type IconName =
  | 'arrow'
  | 'box'
  | 'check'
  | 'chevron'
  | 'close'
  | 'copy'
  | 'cube'
  | 'door'
  | 'download'
  | 'flip'
  | 'focus'
  | 'grid'
  | 'home'
  | 'image'
  | 'menu'
  | 'layers'
  | 'panel'
  | 'plus'
  | 'pointer'
  | 'redo'
  | 'rotate'
  | 'save'
  | 'search'
  | 'share'
  | 'shopping'
  | 'sliders'
  | 'sofa'
  | 'sun'
  | 'trash'
  | 'undo'
  | 'upload'
  | 'user'
  | 'wall'
  | 'window'


const EURO = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatPrice(value: number | null) {
  return value === null ? 'Price unavailable' : EURO.format(value)
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    box: 'm4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    chevron: 'm7 10 5 5 5-5',
    close: 'M6 6l12 12M18 6 6 18',
    copy: 'M8 8h11v11H8zM5 16H4V4h12v1',
    cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5m0 0L4 7.5',
    door: 'M6 21V4h11v17M3 21h18M14 12.5v.5',
    download: 'M12 3v12m-5-5 5 5 5-5M5 20h14',
    flip: 'M12 3v18M9 7 4 17h5V7Zm6 0 5 10h-5V7Z',
    focus: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m8-5v2m-1-1h2',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    home: 'M4 11 12 4l8 7v9H4v-9Zm6 9v-5h4v5',
    image: 'M4 5h16v14H4zm0 11 5-5 4 4 2-2 5 5M15.5 9.5h.01',
    layers: 'm4 8 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4',
    menu: 'M4 7h16M4 12h16M4 17h16',
    panel: 'M4 5h16v14H4zM9 5v14',
    plus: 'M12 5v14M5 12h14',
    pointer: 'M6 3.5 18 10l-5.2 1.7L10.5 17 6 3.5Zm6.8 8.2L17 18',
    redo: 'M15 13l5-5-5-5M20 8H9.5a5.5 5.5 0 0 0 0 11H13',
    rotate: 'M5 8a7 7 0 1 1 1 8M5 8V4m0 4h4',
    save: 'M5 4h12l2 2v14H5zM8 4v5h7V4M8 15h8v5H8z',
    search: 'm20 20-4.5-4.5M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z',
    share: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    shopping: 'M5 7h14l-1 13H6L5 7Zm3 0a4 4 0 0 1 8 0M9 11v2m6-2v2',
    sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5',
    sofa: 'M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11M3 11.5a1.5 1.5 0 0 1 3 0V14h12v-2.5a1.5 1.5 0 0 1 3 0V18H3v-6.5ZM5.5 18v2m13-2v2',
    sun: 'M12 3v2m0 14v2M3 12h2m14 0h2m-3.36-6.36-1.42 1.42m-8.44 8.44-1.42 1.42m0-11.28 1.42 1.42m8.44 8.44 1.42 1.42M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    trash: 'M5 7h14m-9 4v5m4-5v5M9 7V4h6v3m-9 0 1 13h10l1-13',
    undo: 'M9 13 4 8l5-5M4 8h10.5a5.5 5.5 0 0 1 0 11H11',
    upload: 'M12 16V3m-5 5 5-5 5 5M5 20h14',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
    wall: 'M4 5h16v14H4zM9 5v14m6-14v14M4 10h5m6 0h5M4 15h5m6 0h5',
    window: 'M4 4h16v16H4zM4 12h16M12 4v16',
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

export function ProductThumb({ product, compact = false }: { product: Product; compact?: boolean }) {
  const seating = product.group === 'Seating', table = product.group === 'Tables'
  const className = `product-thumb ${compact ? 'product-thumb-compact' : ''}`
  if (product.thumbnailPath) return <div className={className}><img className="product-thumb-image" src={product.thumbnailPath} alt={`${product.name} generated thumbnail`} /></div>
  return <div className={className}>
    <svg viewBox="0 0 180 130" role="img" aria-label={`${product.name} — illustrative preview`}>
      <ellipse cx="92" cy="108" rx="65" ry="10" fill="#ddd7cb" opacity="0.45" />
      <g stroke={product.accent} strokeWidth="1.3" strokeLinejoin="round">
        {product.mount === 'wall' ? <g>
          <rect x="18" y="8" width="144" height="98" rx="4" fill="#ece8de" stroke="none" />
          {product.category === 'Mirror' ? <><circle cx="90" cy="55" r="34" fill={product.accent} /><circle cx="90" cy="55" r="29" fill={product.tone} /><path d="M74 42l18-12M76 54l26-18" stroke="#fff" opacity=".7" /></>
            : product.category === 'Wall shelf' ? <><path d="M38 64h104v8H38Z" fill={product.tone} /><path d="M50 64V48h12v16m14 0V42h9v22m30 0-8-20 10-3 7 23" fill={product.accent} opacity=".55" /></>
              : product.category === 'Wall TV' ? <><rect x="34" y="26" width="112" height="64" rx="3" fill={product.accent} /><rect x="38" y="30" width="104" height="56" fill={product.tone} /><path d="M44 80 140 36" stroke="#4a5258" opacity=".5" /></>
                : product.category === 'Wall cabinet' ? <><rect x="46" y="20" width="88" height="70" rx="3" fill={product.tone} /><path d="M90 20v70M84 80v-9m12 9v-9" fill="none" strokeWidth="2" /></>
                  : <><rect x="40" y="24" width="100" height="66" rx="2" fill={product.accent} /><rect x="47" y="31" width="86" height="52" fill="#f4efe4" stroke="none" /><rect x="53" y="58" width="74" height="20" fill={product.tone} stroke="none" /><rect x="53" y="37" width="74" height="19" fill="#c9d3cf" stroke="none" /></>}
        </g> : seating ? <g>
          <path d="M38 91v17m92-18v18m-75-5v9m87-22v12" strokeWidth="4" />
          <path d={(product.category === 'Sofa' || product.category === 'Corner sofa') ? 'M28 55 Q28 43 40 45 L135 35 Q145 35 145 48 L145 84 L30 94Z' : 'M64 30 L116 25 L119 76 L67 84Z'} fill={product.tone} />
          <path d={(product.category === 'Sofa' || product.category === 'Corner sofa') ? 'M31 78 L125 65 L150 80 L56 99 L31 91Z' : 'M64 77 L113 68 L133 82 L84 95 L64 85Z'} fill={product.tone} />
          {(product.category === 'Sofa' || product.category === 'Corner sofa') && <><path d="M29 68 Q21 64 22 74 L23 92 L40 99 L40 77Z M132 55 L147 53 L156 61 L155 83 L139 88 L138 65Z" fill={product.accent} /><path d="M61 53v23m35-26v22M42 80l94-14" fill="none" opacity="0.5" /></>}
        </g> : table ? <g><path d="M44 64v39m89-50v37M63 80v31m85-45v39" strokeWidth="6" /><path d="M27 59 L115 36 L159 62 L69 91 L27 68Z" fill={product.accent} /><path d="M27 59 L115 36 L159 62 L69 84Z" fill={product.tone} /><path d="M42 60l72-18M54 67l71-19" opacity="0.35" /></g> : product.category === 'Rug' ? <g><path d="M23 79 L116 43 L163 78 L65 113Z" fill={product.tone} /><path d="M33 80l83-31 36 28-85 29Z" fill="none" /><path d="M43 81l70-26m-60 34 72-27m-60 34 71-28" opacity="0.3" /></g> : product.category === 'Floor lamp' ? <g><ellipse cx="91" cy="107" rx="24" ry="5" fill={product.accent} /><path d="M91 104V38" strokeWidth="3" /><path d="M75 23h31l19 34Q92 68 57 57Z" fill={product.tone} /><ellipse cx="91" cy="23" rx="16" ry="4" fill="#eee5d2" /></g> : product.category === 'Plant' ? <g><path d="M71 86h41l-7 26H78Z" fill="#b3a28c" stroke="#8b7964" /><path d="M92 90V30m0 34L68 47m24 32 22-23" fill="none" strokeWidth="3" /><ellipse cx="69" cy="41" rx="14" ry="23" transform="rotate(-35 69 41)" fill={product.tone} /><ellipse cx="112" cy="48" rx="15" ry="24" transform="rotate(25 112 48)" fill={product.accent} /><ellipse cx="91" cy="28" rx="13" ry="23" fill={product.tone} /></g> : product.group === 'Bedroom' ? <g><path d="M37 82h108v20H37Z" fill={product.accent} /><path d="M45 61h92v28H45Z" fill={product.tone} /><path d="M51 43h80v22H51Z" fill={product.accent} /><path d="M55 65h27v20H55Z" fill="#ece7dc" /><path d="M98 65h34v20H98Z" fill="#ece7dc" /></g> : product.group === 'Bathroom' ? product.category === 'Shower' ? <g><rect x="47" y="25" width="88" height="78" rx="4" fill={product.tone} opacity=".3" /><path d="M47 25h88v78H47M54 96h74M91 25v78" fill="none" /><circle cx="91" cy="42" r="11" fill="none" /></g> : product.category === 'Bathtub' ? <g><path d="M36 68h112v25H36Z" fill={product.tone} /><path d="M47 68V53q0-12 12-12h61q13 0 13 12v15" fill="none" strokeWidth="4" /><path d="M52 80h80" opacity=".4" /></g> : <g><path d="M52 43h76v45q0 18-38 18T52 88Z" fill={product.tone} /><path d="M60 42h60V27H60Z" fill={product.accent} /><ellipse cx="90" cy="80" rx="25" ry="7" fill="#f8f8f3" /></g> : product.group === 'Kitchen' ? product.category === 'Refrigerator' ? <g><path d="M58 21h66v86H58Z" fill={product.tone} /><path d="M60 61h62M113 35v17m0 28v14" fill="none" /></g> : <g><path d="M31 50h118v57H31Z" fill={product.tone} /><path d="M27 45h126v13H27Z" fill={product.accent} /><path d="M60 60v47m60-47v47M49 78h9m62 0h9" fill="none" strokeWidth="3" /></g> : <g><path d="M36 49 L123 31 L148 46 L61 66Z" fill={product.tone} /><path d="M36 49v44l25 16V66Z" fill={product.accent} /><path d="M61 66l87-20v44l-87 19Z" fill={product.tone} /><path d="M89 60v42m31-49v42M38 96v10m105-13v10" fill="none" strokeWidth="2" />{product.category === 'Shelving' && <path d="M64 80l82-19M64 95l82-19" strokeWidth="5" />}</g>}
      </g>
    </svg>
  </div>
}
