import { useRef, useState, type FormEvent } from 'react'
import './showcase.css'
import './business.css'

const Arrow = ({ diagonal = false }: { diagonal?: boolean }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Business() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const closeMenu = () => setMenuOpen(false)
  const openBrief = () => {
    setDownloaded(false)
    dialog.current?.showModal()
  }
  const createBrief = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    download('forma-business-pilot-brief.json', {
      status: 'local-draft-not-submitted',
      company: form.get('company'),
      email: form.get('email'),
      catalogue: form.get('catalogue'),
      opportunity: 'Test whether room-scale product discovery reduces uncertainty and improves the furniture purchase journey.',
      proposedPilot: ['Select a focused catalogue and confirm usage permissions.', 'Create product-specific 3D models with approved dimensions and variants.', 'Test a room-planning journey alongside the existing online store.', 'Agree success measures and the handoff to the retailer checkout or sales team.'],
      currentPrototype: 'Local Forma prototype with custom room drawing, authored sample products, 2D and 3D placement, render views, saved projects and downloadable quote drafts.',
    })
    setDownloaded(true)
  }

  return <div className="showcase b2b">
    <a className="s-skip" href="#main">Skip to content</a>
    <header className="s-header b2b-header">
      <a className="s-wordmark" href="/" aria-label="Forma home">forma<span aria-hidden="true">✳</span></a>
      <span className="b2b-audience">FOR BUSINESSES</span>
      <nav className={menuOpen ? 's-nav s-nav-open' : 's-nav'} aria-label="Business navigation">
        <a href="#why" onClick={closeMenu}>Why it works</a>
        <a href="#flow" onClick={closeMenu}>How it works</a>
        <a href="#pilot" onClick={closeMenu}>Pilot scope</a>
      </nav>
      <a href="/planner" className="s-header-cta">Open customer demo <Arrow diagonal /></a>
      <button className="s-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Close' : 'Menu'} <span aria-hidden="true">{menuOpen ? '×' : '+'}</span></button>
    </header>

    <main id="main">
      <section className="b2b-hero" aria-labelledby="business-heading">
        <div className="b2b-hero-copy">
          <span className="s-kicker"><span className="s-dot" /> FOR ONLINE FURNITURE STORES</span>
          <h1 id="business-heading">Let shoppers see it in <em>their room.</em></h1>
          <p>Turn your existing furniture catalogue into an interactive 3D shopping experience. Customers can draw a space, place your products at their real dimensions, and feel more confident before they buy.</p>
          <div className="b2b-hero-actions"><button className="s-button s-button-dark" onClick={openBrief}>Talk through a pilot <Arrow diagonal /></button><a className="s-text-link" href="#flow">See how it works <Arrow /></a></div>
          <span className="b2b-hero-note">WORKING PROTOTYPE · LOCAL SAMPLE CATALOGUE · NO LIVE INTEGRATIONS YET</span>
        </div>
        <div className="b2b-hero-art">
          <img src="/showcase-room.jpg" alt="Original Forma render of a furnished room with a sofa, coffee table and warm daylight" width="1400" height="1250" fetchPriority="high" />
          <span className="b2b-art-index">THE CUSTOMER VIEW / 001</span>
          <div className="b2b-art-card"><span>YOUR CATALOGUE</span><strong>In their space.</strong><small>Real dimensions · considered context</small></div>
          <span className="b2b-art-caption">AUTHORED SAMPLE GEOMETRY · SPATIAL SHOPPING STUDY</span>
        </div>
        <div className="b2b-hero-bottom"><span>FROM PRODUCT PAGE TO ROOM-SCALE CONFIDENCE.</span><a href="#why">SCROLL TO EXPLORE <span aria-hidden="true">↓</span></a></div>
      </section>

      <div className="b2b-value-strip"><span>Use the catalogue you already have</span><span aria-hidden="true">✳</span><span>Place products at real dimensions</span><span aria-hidden="true">✳</span><span>Designed to reduce purchase uncertainty</span></div>

      <section className="b2b-section b2b-why" id="why">
        <div className="b2b-section-index">01 / THE PROBLEM WORTH SOLVING</div>
        <div className="b2b-why-main"><h2>The product page answers <em>what.</em><br />The room answers <em>will it work?</em></h2><p>Furniture is difficult to buy online because shoppers have to imagine scale, proportion and fit from isolated images. Forma moves that decision into the space they are already trying to furnish.</p></div>
        <div className="b2b-business-case"><span>THE BUSINESS CASE</span><strong>Make confidence part of the product story.</strong><p>The goal is straightforward: remove uncertainty from the purchase decision and give your team a clearer conversion hypothesis to test with real shoppers.</p></div>
      </section>

      <section className="b2b-section b2b-flow" id="flow">
        <div className="b2b-heading"><div><div className="b2b-section-index">02 / A SIMPLE CUSTOMER JOURNEY</div><h2>From your catalogue<br />to <em>their room.</em></h2></div><p>One spatial layer around the catalogue you already sell. Start with the products and customer journey where context can make the biggest difference.</p></div>
        <div className="b2b-space-inputs" aria-label="Illustrative ways shoppers can start">
          <div className="b2b-space-option"><div className="b2b-space-preview b2b-space-draw" aria-hidden="true"><svg viewBox="0 0 260 145" fill="none"><rect x="35" y="22" width="190" height="101" stroke="currentColor" strokeWidth="3" /><path d="M35 89h33V55h47v34h110M115 22v33M181 22v22" stroke="currentColor" strokeWidth="3" /><rect x="79" y="63" width="57" height="18" rx="3" fill="currentColor" opacity=".3" /><circle cx="171" cy="83" r="12" fill="currentColor" opacity=".3" /></svg><span>6.00 × 4.50 m</span></div><div><span>01 / WORKING NOW</span><strong>Draw the space</strong><p>Set the walls, openings and dimensions directly in the room planner.</p></div></div>
          <div className="b2b-space-option"><div className="b2b-space-preview b2b-space-photo" aria-hidden="true"><div className="b2b-photo-sheet"><span>LAYOUT PHOTO</span><i /><i /><i /><b>+</b></div></div><div><span>02 / PILOT CONCEPT</span><strong>Upload a layout photo</strong><p>Start from a plan or room image when drawing from scratch is not the easiest first step.</p></div></div>
        </div>
        <ol className="b2b-steps">
          <li><span>01</span><h3>Bring the catalogue</h3><p>Share the product data, dimensions, imagery, variants and permissions needed to create product-specific 3D models.</p><small>CATALOGUE SETUP</small></li>
          <li><span>02</span><h3>Let shoppers build a space</h3><p>Customers draw a room to scale, or scope an image-based layout import as part of a focused pilot.</p><small>ROOM-SCALE INTENT</small></li>
          <li><span>03</span><h3>Make the fit visible</h3><p>They place your sofa, bed, table or other pieces without resizing them to force a fit, then explore the arrangement in 2D and 3D.</p><small>INTERACTIVE 3D</small></li>
          <li><span>04</span><h3>Hand the intent back</h3><p>Turn a considered room into a stronger product conversation, quote request or route back to your existing store.</p><small>YOUR COMMERCIAL FLOW</small></li>
        </ol>
      </section>

      <section className="b2b-pilot" id="pilot">
        <div className="b2b-pilot-visual"><img src="/showcase-sofa-haven.jpg" alt="Original Forma render of the Haven sample sofa with a 220 centimetre measurement" width="900" height="720" /><span className="b2b-pilot-label">A PRODUCT IN CONTEXT</span><div className="b2b-measure"><span />220 CM<span /></div><span className="b2b-pilot-note">HAVEN / AUTHORED SAMPLE / 220 × 92 × 82 CM</span></div>
        <div className="b2b-pilot-copy"><span className="b2b-section-index">03 / START WITH A FOCUSED PILOT</span><h2>Begin where fit matters most.</h2><p>Pick a small set of products with high consideration, build the models properly, and learn what helps your customers move from “I like it” to “it works here.”</p><ul><li><b>01</b><span>Choose a focused catalogue and confirm model usage rights.</span></li><li><b>02</b><span>Agree dimensions, variants, data ownership and the handoff to your team.</span></li><li><b>03</b><span>Test room-scale discovery beside the store journey and measure what changes.</span></li></ul><button className="s-button s-button-acid" onClick={openBrief}>Download the pilot brief <Arrow diagonal /></button><small>No lead form is connected. This downloads a local brief for a conversation.</small></div>
      </section>

      <section className="b2b-section b2b-stack" id="integration">
        <div className="b2b-heading"><div><div className="b2b-section-index">04 / BUILT AROUND YOUR BUSINESS</div><h2>Useful before<br /><em>it is connected.</em></h2></div><p>Forma is designed as a conversion layer around an existing furniture store—not a replacement for your catalogue, checkout or operational systems. Customers can browse your products in the room-scale viewer, then continue to your product, quote or checkout flow.</p></div>
        <div className="b2b-architecture" aria-label="Illustrative pilot architecture"><div><span>01</span><strong>Your catalogue</strong><small>Products · dimensions · variants</small></div><b aria-hidden="true">+</b><div className="b2b-architecture-highlight"><span>02</span><strong>Forma spatial layer</strong><small>Room builder · product models · 2D / 3D</small></div><b aria-hidden="true">→</b><div><span>03</span><strong>Your commercial flow</strong><small>Store · quote · sales handoff</small></div></div>
        <p className="b2b-architecture-note">Illustrative pilot architecture. Embedding, APIs, checkout handoff, analytics and live catalogue feeds are implementation work to scope with a partner.</p>
      </section>

      <section className="b2b-faq b2b-section">
        <div><div className="b2b-section-index">A FEW THINGS, UP FRONT.</div><h2>Good questions.<br /><em>Straight answers.</em></h2></div>
        <div>{[
          ['Does this replace our online store?', 'No. The intended role is a spatial layer around the store you already run. The exact link, embed or handoff should be agreed during a pilot.'],
          ['What do you need from our catalogue?', 'A focused product set, reliable dimensions, approved imagery or materials, variant information and permission to create and use the models.'],
          ['Can shoppers upload a room photo?', 'The working prototype supports drawing a room directly. Image-based layout import is a pilot feature to scope, not a live capability on this page.'],
          ['Can you promise higher conversion?', 'No uplift is claimed before measurement. The purpose of a pilot is to test whether less uncertainty creates a better customer journey and stronger commercial outcomes.'],
        ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="b2b-final"><div className="b2b-final-top"><span className="b2b-section-index">MAKE YOUR CATALOGUE FEEL CLOSER TO HOME.</span><span aria-hidden="true">↙</span></div><h2>Show the piece.<br />Sell the <em>possibility.</em></h2><div className="b2b-final-bottom"><p>Start with a focused range.<br />Learn what the room changes.</p><div><button className="s-button s-button-dark" onClick={openBrief}>Start a pilot conversation <Arrow diagonal /></button><a className="s-text-link" href="/planner">Open the working planner <Arrow /></a></div></div></section>
    </main>

    <footer className="b2b-footer"><a className="s-wordmark" href="/" aria-label="Forma home">forma<span aria-hidden="true">✳</span></a><p>Spatial shopping tools<br />for furniture businesses.</p><div><a href="/">For shoppers <span aria-hidden="true">↗</span></a><a href="/planner">Open the planner <span aria-hidden="true">↗</span></a><a href="#main">Back to top <span aria-hidden="true">↑</span></a></div><div className="b2b-footer-base"><span>© {new Date().getFullYear()} FORMA</span><span>BUSINESS PROTOTYPE · PILOT CONVERSATIONS WELCOME</span></div></footer>

    <dialog className="s-brief b2b-brief" ref={dialog} onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }} aria-labelledby="business-brief-title">
      <button className="s-brief-close" aria-label="Close pilot brief" onClick={() => dialog.current?.close()}>×</button>
      <span className="s-kicker">A PRACTICAL FIRST CONVERSATION</span>
      <h2 id="business-brief-title">Let’s find the fit.</h2>
      <p>Tell us a little about the catalogue you want to make spatial. This creates a local draft only; it does not send a lead or start an integration.</p>
      {downloaded ? <div role="status" className="s-brief-success"><h3>Your pilot brief is downloaded.</h3><p>Nothing was submitted. Share the file with the person you want to bring into the conversation.</p><button className="s-button s-button-dark" onClick={() => dialog.current?.close()}>Keep exploring <Arrow /></button></div> : <form onSubmit={createBrief}><label>Company or organisation<input name="company" required maxLength={160} placeholder="Your shop or brand" autoComplete="organization" /></label><label>Email<input name="email" type="email" required maxLength={254} placeholder="you@company.com" autoComplete="email" /></label><label>What catalogue would you start with?<textarea name="catalogue" maxLength={2000} rows={3} placeholder="A product range, category or pilot idea…" /></label><p className="s-brief-privacy">Local draft only. Your details are written to a file on your device, not to our inbox. Contact and CRM integrations are not connected.</p><button className="s-button s-button-dark" type="submit">Download local pilot brief <Arrow diagonal /></button></form>}
    </dialog>
  </div>
}
