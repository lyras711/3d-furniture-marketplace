import { doorStyles, openingSizes, openingStyle, windowStyles, type DoorStyle, type RoomFeature, type WindowStyle } from './editor'
import { Icon } from './ui'

type OpeningStyle = DoorStyle | WindowStyle
const styleLabels: Record<OpeningStyle, string> = { hinged: 'Single door', double: 'Double door', sliding: 'Sliding door', opening: 'Open doorway', casement: 'Opening window', fixed: 'Fixed window', balcony: 'Balcony door' }
// Plan-style pictograms: wall line along the bottom, leaf and swing above it.
const glyphs: Record<OpeningStyle, string> = {
  hinged: 'M2 30h10m24 0h10M12 30V6M12 6a24 24 0 0 1 24 24',
  double: 'M2 30h6m32 0h6M8 30V14m0 0a16 16 0 0 1 16 16m16 0V14m0 0a16 16 0 0 0-16 16',
  sliding: 'M2 30h6m32 0h6M8 27h20m-8 6h20m-6-12 4 4-4 4',
  opening: 'M2 30h8m28 0h8M10 24v12m28-12v12',
  casement: 'M8 6h32v24H8zM24 6v24M8 30h32',
  fixed: 'M8 6h32v24H8zM6 32h36',
  balcony: 'M14 3h20v30H14zM24 3v30M2 33h44',
}

export default function OpeningOptions({ feature, onPatch }: { feature: RoomFeature; onPatch: (patch: Partial<RoomFeature>) => void }) {
  const style = openingStyle(feature), door = feature.type === 'door', styles: OpeningStyle[] = door ? doorStyles : windowStyles
  const sizes = openingSizes[style]
  const matches = (size: (typeof sizes)[number]) => Math.abs(size.width - feature.width) < 0.01 && Math.abs(size.height - feature.height) < 0.01
  const chooseStyle = (next: OpeningStyle) => { const size = openingSizes[next][0]; onPatch({ style: next, width: size.width, height: size.height, sillHeight: size.sillHeight }) }
  return <>
    <section className="inspector-section">
      <div className="section-label-row"><span>Type</span></div>
      <div className="opening-styles" role="radiogroup" aria-label={door ? 'Door type' : 'Window type'}>
        {styles.map((option) => <button key={option} type="button" role="radio" aria-checked={style === option} className={style === option ? 'opening-style-active' : ''} onClick={() => chooseStyle(option)}>
          <svg viewBox="0 0 48 36" width="48" height="36" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={glyphs[option]} /></svg>
          <span>{styleLabels[option]}</span>
        </button>)}
      </div>
    </section>
    <section className="inspector-section">
      <div className="section-label-row"><span>Common sizes</span></div>
      <div className="opening-sizes" role="group" aria-label="Common sizes">
        {sizes.map((size) => <button key={size.label} type="button" aria-pressed={matches(size)} onClick={() => onPatch({ width: size.width, height: size.height, sillHeight: size.sillHeight })}>{size.label}</button>)}
      </div>
    </section>
    {door && (style === 'hinged' || style === 'double') && <section className="inspector-section">
      <div className="section-label-row"><span>Opens</span></div>
      <div className="opening-sizes" role="group" aria-label="Door opens">
        <button type="button" aria-pressed={feature.swing !== 'out'} onClick={() => onPatch({ swing: 'in' })}>Into the room</button>
        <button type="button" aria-pressed={feature.swing === 'out'} onClick={() => onPatch({ swing: 'out' })}>Outward</button>
      </div>
      {style === 'hinged' && <button type="button" className="secondary-button opening-hinge" onClick={() => onPatch({ hinge: feature.hinge === 'right' ? 'left' : 'right' })}><Icon name="flip" /> Hinge on the other side</button>}
    </section>}
  </>
}
