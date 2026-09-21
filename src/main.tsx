import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { products } from './catalog'
import './styles.css'

const App = lazy(() => import('./App'))
const Showcase = lazy(() => import('./Showcase'))
const ShowcaseScene = lazy(() => import('./ShowcaseScene'))
const Admin = lazy(() => import('./Admin'))
const Business = lazy(() => import('./Business'))
const requestedArt = new URLSearchParams(location.search).get('art')
const art = requestedArt === 'room' || products.some((product) => product.id === requestedArt) ? requestedArt : null
const pathname = location.pathname.replace(/\/$/, '')
const admin = pathname === '/admin'
const business = pathname === '/for-business' || pathname === '/b2b'
const planner = pathname === '/planner' || location.hash.startsWith('#project=')
document.body.classList.toggle('showcase-page', !planner && !admin)
document.body.classList.toggle('business-page', business)
if (planner) document.title = 'Forma — room planner'
if (business) {
  document.title = 'Forma for business — spatial shopping for furniture'
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'Forma helps online furniture stores turn their catalogue into an interactive room-scale shopping experience.')
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', 'Forma for business — spatial shopping for furniture')
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', 'Turn your furniture catalogue into interactive 3D products and help shoppers see the fit before they buy.')
}
if (admin) document.title = 'Forma — catalog admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening Forma…</div>}>
      {admin ? <Admin /> : planner ? <App /> : business ? <Business /> : art ? <div style={{ width: '100vw', height: '100dvh' }}><ShowcaseScene art product={art === 'room' ? undefined : art} /></div> : <Showcase />}
    </Suspense>
  </StrictMode>,
)
