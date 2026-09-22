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
const shopper = pathname === '/for-shoppers'
const planner = pathname === '/planner' || location.hash.startsWith('#project=')
const business = !planner && (pathname === '' || pathname === '/for-business' || pathname === '/b2b')
document.body.classList.toggle('showcase-page', !planner && !admin)
document.body.classList.toggle('business-page', business)
if (planner) document.title = 'Formivo — room planner'
if (shopper) document.title = 'Formivo — Make room for possibility.'
if (business) {
  document.title = 'Formivo for business — spatial shopping for furniture'
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'Formivo helps online furniture stores turn their catalogue into an interactive room-scale shopping experience.')
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', 'Formivo for business — spatial shopping for furniture')
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', 'Turn your furniture catalogue into interactive 3D products and help shoppers see the fit before they buy.')
}
if (admin) document.title = 'Formivo — catalog admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening Formivo…</div>}>
      {admin ? <Admin /> : planner ? <App /> : art ? <div style={{ width: '100vw', height: '100dvh' }}><ShowcaseScene art product={art === 'room' ? undefined : art} /></div> : business ? <Business /> : <Showcase />}
    </Suspense>
  </StrictMode>,
)
