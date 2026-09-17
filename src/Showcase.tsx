import { Component, lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { products } from './catalog'
import { emptyProject, wallFromPoints } from './editor'
import './showcase.css'

const ShowcaseScene = lazy(() => import('./ShowcaseScene'))
const sampleIds = ['sofa-haven', 'table-arc', 'lamp-halo', 'rug-loom']
const samples = sampleIds.map((id) => products.find((p) => p.id === id)!)
const positions: Record<string, [number, number]> = { 'sofa-haven': [0, -1.25], 'table-arc': [0, 0.25], 'lamp-halo': [1.65, -1.35], 'rug-loom': [0, 0.15] }
const euro = (n: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const Arrow = ({ diagonal = false }: { diagonal?: boolean }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function demoProject(selected: string[]) {
  const project = emptyProject('The Sunday room')
  const corners = [{ x: -3, z: -2 }, { x: 3, z: -2 }, { x: 3, z: 2.5 }, { x: -3, z: 2.5 }]
  project.features = corners.map((point, i) => wallFromPoints(`showcase-wall-${i}`, point, corners[(i + 1) % 4], 2.8))
  project.objects = selected.map((productId) => ({ id: `showcase-${productId}`, productId, x: positions[productId][0], z: positions[productId][1], rotation: 0 }))
  return project
}

function FloorPlan({ built, selected }: { built: boolean; selected: string[] }) {
  return <svg className="s-floor-plan" viewBox="0 0 640 460" role="img" aria-label={built ? `Top-down room plan with ${selected.length} selected products` : 'Empty build grid, ready to draw a room'}>
    <defs><pattern id="demo-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#aaa99b" /></pattern><pattern id="demo-rug" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0v5" stroke="#b9ad93" strokeWidth="1" /></pattern></defs>
    <rect width="640" height="460" fill="url(#demo-grid)" />
    <g className={built ? 's-plan-built' : 's-plan-outline'}>
      <rect x="110" y="65" width="420" height="315" fill={built ? '#e9e3d3' : 'none'} stroke={built ? '#797964' : '#999b83'} strokeWidth={built ? 8 : 1} strokeDasharray={built ? undefined : '6 6'} />
      <path d="M110 405v10m0-5h420m0-5v10M555 65h10m-5 0v315m-5 0h10" stroke="#969887" fill="none" />
      <text x="320" y="435" textAnchor="middle">6.00 m</text><text x="578" y="227" transform="rotate(-90 578 227)" textAnchor="middle">4.50 m</text>
    </g>
    {selected.includes('rug-loom') && <g><rect x="236" y="156" width="168" height="119" rx="2" fill="#d6cbb4" /><rect x="242" y="162" width="156" height="107" fill="url(#demo-rug)" /></g>}
    {selected.includes('sofa-haven') && <g fill="#c4b296" stroke="#9c896d" strokeWidth="1"><rect x="243" y="86" width="154" height="64.4" rx="8" /><rect x="254" y="92" width="43" height="15" rx="4" /><rect x="298" y="92" width="43" height="15" rx="4" /><rect x="342" y="92" width="43" height="15" rx="4" /><rect x="254" y="110" width="43" height="32" rx="4" /><rect x="298" y="110" width="43" height="32" rx="4" /><rect x="342" y="110" width="43" height="32" rx="4" /></g>}
    {selected.includes('table-arc') && <rect x="281.5" y="201.5" width="77" height="42" rx="5" fill="#ab8053" stroke="#805f3e" />}
    {selected.includes('lamp-halo') && <g><circle cx="435.5" cy="110.5" r="14.7" fill="#b8a078" stroke="#7b7054" /><circle cx="435.5" cy="110.5" r="5" fill="#ede3c8" /></g>}
    {!selected.length && <g fill="#777b62"><path d="M310 222h20m-10-10v20" stroke="currentColor" /><text x="320" y="258" textAnchor="middle">{built ? 'Your space. Your possibilities.' : 'Every good room starts here.'}</text></g>}
  </svg>
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <>{this.props.fallback}<span className="s-gpu-note">3D unavailable on this device. Your 2D demo still works.</span></> : this.props.children }
}

function RoomDemo() {
  const [stage, setStage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [threeD, setThreeD] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tour, setTour] = useState(0)
  const items = samples.filter((p) => selected.includes(p.id))
  const total = items.reduce((sum, p) => sum + (p.price ?? 0), 0)
  const retailers = [...new Set(items.map((p) => p.retailer))]
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (tour === 0) setStage(1)
      else if (tour <= samples.length) setSelected(sampleIds.slice(0, tour))
      else { setStage(2); setPlaying(false) }
      setTour((n) => n + 1)
    }, tour === 0 ? 1000 : 1300)
    return () => clearTimeout(timer)
  }, [playing, tour])
  const reset = () => { setPlaying(false); setTour(0); setStage(0); setSelected([]); setThreeD(false) }
  const toggle = (id: string) => { setPlaying(false); setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }
  const exportQuote = () => {
    download('forma-demo-quote.json', { status: 'draft-not-submitted', currency: 'EUR', estimatedTotal: total, disclaimer: 'Illustrative sample products. Prices, stock, delivery and installation require confirmation. No order placed or payment taken.', project: demoProject(selected), retailers: retailers.map((retailer) => ({ retailer, items: items.filter((p) => p.retailer === retailer) })) })
    setStage(3)
  }
  const floor = <FloorPlan built={stage > 0} selected={selected} />
  return <div className="s-demo" data-stage={stage}>
    <div className="s-demo-bar"><span><i /> THE SUNDAY ROOM <span className="s-demo-meta">/ INTERACTIVE SAMPLE</span></span><button onClick={reset}>Reset demo <span aria-hidden="true">↺</span></button></div>
    <div className="s-demo-content">
      <div className="s-demo-viewport">
        <div className="s-view-switch" aria-label="Demo view"><button aria-pressed={!threeD} onClick={() => setThreeD(false)}>2D plan</button><button aria-pressed={threeD} onClick={() => setThreeD(true)}>3D view</button></div>
        {threeD ? <SceneBoundary fallback={floor}><Suspense fallback={floor}><ShowcaseScene selected={selected} built={stage > 0} /></Suspense></SceneBoundary> : floor}
        <div className="s-demo-scene-caption"><span>{stage === 0 ? 'A blank canvas.' : `${items.length} ${items.length === 1 ? 'piece' : 'pieces'}. One considered room.`}</span><span>{threeD ? 'DRAG TO EXPLORE' : '27 M² / TO SCALE'}</span></div>
      </div>
      <div className="s-demo-panel">
        <div className="s-demo-steps" aria-label="Demo progress">{['Draw', 'Furnish', 'Review', 'Quote'].map((name, i) => <span key={name} aria-current={stage === i ? 'step' : undefined} className={stage >= i ? 's-step-current' : ''}><b>0{i + 1}</b>{name}</span>)}</div>
        <div className="s-demo-panel-body" aria-live="polite">
          {stage === 0 ? <><span className="s-kicker">01 / A SPACE THAT’S YOURS</span><h3>Start with<br />possibility.</h3><p>Draw the room. Find the pieces. See the whole picture before making a decision.</p><div className="s-demo-room-size"><span>6.00 × 4.50 m</span><small>A sample living room</small></div><button className="s-button s-button-dark" onClick={() => { setPlaying(false); setStage(1) }}>Draw my room <Arrow /></button><button className="s-demo-play" onClick={() => { reset(); setPlaying(true) }}>{playing ? 'Playing walkthrough…' : 'Or, play the walkthrough'} <span aria-hidden="true">▷</span></button></> : stage === 1 ? <><span className="s-kicker">02 / BETTER, TOGETHER</span><h3>Make yourself<br />at home.</h3><p>Add a few favourites. Your room and estimate update together.</p><div className="s-demo-products">{samples.map((product) => <button key={product.id} aria-pressed={selected.includes(product.id)} onClick={() => toggle(product.id)}><img src={`/showcase-${product.id}.jpg`} alt="" loading="lazy" /><span><strong>{product.name.replace('three-seat ', '').replace('wool ', '')}</strong><small>{product.retailer} · {euro(product.price ?? 0)}</small></span><b aria-hidden="true">{selected.includes(product.id) ? '−' : '+'}</b></button>)}</div><button className="s-button s-button-dark" disabled={!items.length} onClick={() => { setPlaying(false); setStage(2) }}>Review {items.length} {items.length === 1 ? 'piece' : 'pieces'} <Arrow /></button></> : stage === 2 ? <><span className="s-kicker">03 / THE WHOLE PICTURE</span><h3>One room.<br />One shortlist.</h3><div className="s-demo-basket">{retailers.map((retailer) => <div key={retailer}><small>{retailer} <span>Sample retailer</span></small>{items.filter((p) => p.retailer === retailer).map((p) => <p key={p.id}><span>{p.name}</span><strong>{euro((p.price ?? 0))}</strong></p>)}</div>)}</div><button className="s-button s-button-dark" onClick={exportQuote}>Download quote draft <Arrow diagonal /></button><button className="s-demo-play" onClick={() => setStage(1)}>Back to furnishing</button></> : <><span className="s-kicker">04 / READY FOR THE NEXT STEP</span><div className="s-draft-mark" aria-hidden="true">✓</div><h3>From a room<br />to a real brief.</h3><p>Your quote draft has been downloaded, grouped by sample retailer. No order was placed, no payment taken, and nothing was sent.</p><a className="s-button s-button-dark" href="/planner">Open the full planner <Arrow diagonal /></a><button className="s-demo-play" onClick={exportQuote}>Download draft again</button></>}
        </div>
        <div className="s-demo-total"><span>Illustrative estimate<strong>{euro(total)}</strong></span><small>Sample prices. Not a checkout.<br />Delivery & availability unverified.</small></div>
      </div>
    </div>
    {playing && <div className="s-tour-status" role="status">Walkthrough playing <button onClick={() => setPlaying(false)}>Stop & take over</button></div>}
  </div>
}

export default function Showcase() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [audience, setAudience] = useState<'retailer' | 'investor'>('retailer')
  const [downloaded, setDownloaded] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const openBrief = (type: 'retailer' | 'investor') => { setAudience(type); setDownloaded(false); dialog.current?.showModal() }
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('s-in-view'); observer.unobserve(entry.target) } }), { threshold: 0.08 })
    document.querySelectorAll('.s-reveal').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])
  const createBrief = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    download(`forma-${audience}-brief.json`, { audience, company: form.get('company'), email: form.get('email'), notes: form.get('notes'), status: 'local-draft-not-submitted', currentProduct: 'Local 3D room-planning prototype with nine sample products, render studio and multi-retailer quote drafts.', opportunity: audience === 'retailer' ? 'Explore a pilot using permissioned product models and verified catalogue data. Agree catalogue scope, feed ownership, quote handoff and measurement before launch.' : 'Explore spatial shopping as the connection between room-scale intent and retailer fulfilment. Retailer feeds, checkout, attribution and revenue model are not yet implemented or validated.', nextSteps: ['Arrange a founder conversation through the person who shared Forma with you.', 'Review the live planner and agree a focused pilot.', 'Validate shopper demand and retailer operational fit before scaling.'] })
    setDownloaded(true)
  }
  return <div className="showcase">
    <a className="s-skip" href="#main">Skip to content</a>
    <header className="s-header">
      <a className="s-wordmark" href="/" aria-label="Forma home">forma<span aria-hidden="true">✳</span></a>
      <nav className={menuOpen ? 's-nav s-nav-open' : 's-nav'} aria-label="Main navigation"><a href="#experience" onClick={() => setMenuOpen(false)}>The experience</a><a href="#retailers" onClick={() => setMenuOpen(false)}>For retailers</a><a href="#vision" onClick={() => setMenuOpen(false)}>The bigger picture</a></nav>
      <a href="/planner" className="s-header-cta">Enter the planner <Arrow diagonal /></a>
      <button className="s-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Close' : 'Menu'} <span aria-hidden="true">{menuOpen ? '×' : '+'}</span></button>
    </header>
    <main id="main">
      <section className="s-hero" aria-labelledby="hero-heading">
        <div className="s-hero-copy"><div className="s-kicker"><span className="s-dot" /> A NEW PERSPECTIVE ON FURNITURE</div><h1 id="hero-heading">Make room<br />for <em>possibility.</em></h1><p>Your space. Your favourite pieces.<br />Finally, in the same picture.</p><a className="s-button s-button-dark" href="#experience">See it come together <Arrow /></a><div className="s-hero-footnote"><span className="s-mini-plan" aria-hidden="true">⌑</span><span>FROM THE FIRST WALL<br />TO THE FINAL SHORTLIST.</span></div></div>
        <div className="s-hero-art"><img src="/showcase-room.jpg" alt="An original Forma render: linen sofa, oak table, warm daylight and considered pieces in a quiet living room" fetchPriority="high" width="1400" height="1250" /><span className="s-art-index">SPATIAL STUDY — 001</span><a href="#experience" className="s-product-tag"><span className="s-tag-plus">+</span><span>Haven sofa<small>A little more room to unwind.</small></span><Arrow diagonal /></a><span className="s-art-caption">COMPOSED IN FORMA · AUTHORED SAMPLE GEOMETRY</span><div className="s-hero-stamp" aria-hidden="true"><span>LESS GUESSWORK.</span><b>More<br /><em>feeling.</em></b><span>MEET YOUR SPACE.</span></div></div>
        <div className="s-hero-bottom"><span>DESIGN IT. SEE IT. MAKE IT YOURS.</span><a href="#idea">SCROLL TO EXPLORE <span aria-hidden="true">↓</span></a></div>
      </section>
      <section className="s-intro s-section s-reveal" id="idea"><div className="s-section-index">01 / A BETTER WAY TO FIND HOME</div><div><h2>A room.<br />Not a hundred <span className="s-struck">open tabs.</span></h2><div className="s-intro-bottom"><span className="s-asterisk" aria-hidden="true">✳</span><p>A sofa on one site. A table on another. And no idea if it all works together. Forma brings the decision back to where it belongs: <strong>your space.</strong></p></div></div></section>
      <div className="s-value-strip"><span>Built around your room</span><span aria-hidden="true">✳</span><span>Real-world dimensions</span><span aria-hidden="true">✳</span><span>Many pieces. One picture.</span><span aria-hidden="true">✳</span><span>See before you decide</span></div>
      <section className="s-experience s-section" id="experience"><div className="s-section-heading s-reveal"><div><span className="s-section-index">02 / LESS EXPLAINING. MORE EXPLORING.</span><h2>From empty<br />to <em>“that’s the one.”</em></h2></div><p>Take a little room for a spin.<br />Build it. Furnish it. Bring the pieces together in a quote-ready shortlist.</p></div><RoomDemo /><div className="s-demo-disclaimer"><span>A SMALL DEMO. A BIGGER POSSIBILITY.</span><p>This guided sample ends with a downloadable quote, not a live purchase. Want full control? <a href="/planner">Open the working planner <span aria-hidden="true">↗</span></a></p></div></section>
      <section className="s-features s-section s-reveal"><div className="s-feature"><span>01 / MAKE IT FIT</span><h3>Real dimensions.<br />Less second-guessing.</h3><p>Build your room in metres. Place products at their authored size. Check layouts in 2D and 3D.</p></div><div className="s-feature"><span>02 / SEE THE WHOLE</span><h3>Not just a piece.<br />A point of view.</h3><p>See your arrangement in the render studio, explore the light, and export a view worth sharing.</p></div><div className="s-feature"><span>03 / KEEP IT TOGETHER</span><h3>Different retailers.<br />One considered plan.</h3><p>Keep product details, an illustrative budget, and retailer-grouped quote drafts connected to the room.</p></div></section>
      <section className="s-retailers" id="retailers"><div className="s-retailer-visual"><img src="/showcase-sofa-haven.jpg" alt="The Haven sample sofa rendered at its authored dimensions" loading="lazy" width="900" height="720" /><span className="s-retail-image-title">GOOD DESIGN<br />DESERVES <em>context.</em></span><div className="s-measure"><span />220 CM<span /></div><span className="s-retail-image-note">HAVEN / AUTHORED SAMPLE / 220 × 92 × 82 CM</span></div><div className="s-retailer-copy s-reveal"><span className="s-section-index">03 / FOR FORWARD-THINKING RETAILERS</span><h2>Don’t just be<br />another tab.<br /><em>Be in the room.</em></h2><p>Meet people while they’re deciding how to live—not just what to click.</p><div className="s-retail-benefits"><div><span>01</span><p><strong>Put your products in perspective.</strong>Help shoppers understand a piece in the context of their own room.</p></div><div><span>02</span><p><strong>Become part of the whole project.</strong>A dining table can be the start of a room, not the end of a transaction.</p></div><div><span>03</span><p><strong>Shape the next step with us.</strong>Help define verified catalogues, useful quote requests, and a retailer-friendly handoff.</p></div></div><button className="s-button s-button-acid" onClick={() => openBrief('retailer')}>Explore a retail partnership <Arrow diagonal /></button><small className="s-retail-note">Seeking pilot conversations. No retailer integrations are live.</small></div></section>
      <section className="s-vision s-section" id="vision"><div className="s-section-heading s-reveal"><div><span className="s-section-index">04 / THE BIGGER PICTURE</span><h2>The room is<br />the <em>starting point.</em></h2></div><p>The opportunity isn’t another furniture catalogue. It’s connecting what people imagine with what they can actually bring home.</p></div><div className="s-vision-grid s-reveal"><div className="s-vision-thesis"><span className="s-kicker">OUR THESIS</span><p>Shopping starts<br />with a product.<br /><em>Living starts<br />with a space.</em></p><button className="s-text-link" onClick={() => openBrief('investor')}>Explore the investment thesis <Arrow diagonal /></button></div><div className="s-roadmap"><article><span className="s-status s-status-live">WORKING PROTOTYPE</span><h3>First, make the room work.</h3><p>Custom walls. To-scale placement. Interior rendering. Saved plans and retailer-grouped quote drafts.</p></article><article><span className="s-status">NEXT · VALIDATE WITH PARTNERS</span><h3>Then, connect the catalogue.</h3><p>Permissioned product models, verified prices and stock, and a useful retailer handoff. Built around a focused pilot.</p></article><article><span className="s-status">THE AMBITION</span><h3>Make the whole room shoppable.</h3><p>Connected commerce across retailers, from considered space to fulfilled order. A direction to validate—not a live service.</p></article></div></div></section>
      <section className="s-faq s-section s-reveal"><div><span className="s-section-index">A FEW THINGS, UP FRONT.</span><h2>Good questions.<br /><em>Straight answers.</em></h2></div><div>{[
        ['Can I actually use Forma today?', 'Yes. The working browser prototype lets you build custom rooms, arrange nine sample products, explore 2D and 3D views, render interiors, save locally, share project links, and download shopping lists and quote drafts. No account is needed.'],
        ['Can I buy the furniture here?', 'Not yet. The current journey ends with a downloadable quote draft. Products, retailers and prices are illustrative samples. There is no live stock feed, order submission or payment processing.'],
        ['What would a retailer pilot involve?', 'We would first agree a small, permissioned catalogue, accurate product dimensions and models, responsibility for price and stock data, and a quote handoff your team can support. The pilot should test shopper usefulness and operational fit before adding integrations.'],
        ['What is the business opportunity?', 'Our thesis is that room-scale planning can connect high-intent shoppers with complementary products across retailers. Partner demand, attribution, commercial terms and the revenue model still need validation. No traction or conversion uplift is claimed.'],
        ['Are my plans private?', 'The planner saves on your device, not to a Forma account. Shared links contain your project data, and downloaded drafts may contain details you enter. Share them only with people you trust. This showcase does not submit your partnership details to a server.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="s-final"><div className="s-final-top"><span className="s-section-index">YOUR NEXT CHAPTER, IN PERSPECTIVE.</span><span aria-hidden="true">↙</span></div><h2>Great spaces<br />start with <em>what if.</em></h2><div className="s-final-bottom"><p>For the room you’re imagining.<br />And the future we could build together.</p><div><a className="s-button s-button-dark" href="/planner">Make room for your ideas <Arrow diagonal /></a><button className="s-text-link" onClick={() => openBrief('retailer')}>Bring your catalogue to the conversation <Arrow /></button></div></div></section>
    </main>
    <footer className="s-footer"><a className="s-wordmark" href="/" aria-label="Forma home">forma<span aria-hidden="true">✳</span></a><p>More than furniture.<br />A way to see it together.</p><div><a href="/planner">Try the planner <span aria-hidden="true">↗</span></a><button onClick={() => openBrief('investor')}>For investors <span aria-hidden="true">↗</span></button><a href="#retailers">For retailers <span aria-hidden="true">↗</span></a></div><div className="s-footer-base"><span>© {new Date().getFullYear()} FORMA</span><span>INDEPENDENT PROTOTYPE. BIG POSSIBILITIES.</span><a href="#main">BACK TO TOP ↑</a></div></footer>
    <dialog className="s-brief" ref={dialog} onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }} aria-labelledby="brief-title"><button className="s-brief-close" aria-label="Close brief" onClick={() => dialog.current?.close()}>×</button><span className="s-kicker">{audience === 'retailer' ? 'A BETTER WAY TO SHOW UP' : 'A ROOM-SCALE OPPORTUNITY'}</span><h2 id="brief-title">{audience === 'retailer' ? 'Let’s find the fit.' : 'Think beyond the tab.'}</h2><p>{audience === 'retailer' ? 'Start with a focused catalogue. Agree the handoff. Learn what shoppers and your team actually need.' : 'The thesis: connect room-scale intent with multi-retailer discovery. The next milestone: validate a focused retail pilot, not promise a market we haven’t measured.'}</p>{downloaded ? <div role="status" className="s-brief-success"><h3>Your conversation brief is downloaded.</h3><p>Nothing has been submitted. Share the file with the founder through the person who introduced you to Forma.</p><button className="s-button s-button-dark" onClick={() => dialog.current?.close()}>Keep exploring <Arrow /></button></div> : <form onSubmit={createBrief}><label>Company or organisation<input name="company" required maxLength={160} placeholder={audience === 'retailer' ? 'Your studio, shop or brand' : 'Your organisation'} autoComplete="organization" /></label><label>Email<input name="email" type="email" required maxLength={254} placeholder="you@company.com" autoComplete="email" /></label><label>What would you like to explore?<textarea name="notes" maxLength={2000} rows={3} placeholder={audience === 'retailer' ? 'Your catalogue, market, or pilot ideas…' : 'Your questions, interests, or perspective…'} /></label><p className="s-brief-privacy">Local draft only. Your details go into a file on your device, not to our inbox. Contact and CRM integrations are not connected.</p><button className="s-button s-button-dark" type="submit">Download conversation brief <Arrow diagonal /></button></form>}</dialog>
  </div>
}
