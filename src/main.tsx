import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { products } from './catalog'
import './styles.css'

const App = lazy(() => import('./App'))
const Showcase = lazy(() => import('./Showcase'))
const ShowcaseScene = lazy(() => import('./ShowcaseScene'))
const Admin = lazy(() => import('./Admin'))
const requestedArt = new URLSearchParams(location.search).get('art')
const art = requestedArt === 'room' || products.some((product) => product.id === requestedArt) ? requestedArt : null
const pathname = location.pathname.replace(/\/$/, '')
const admin = pathname === '/admin'
const planner = pathname === '/planner' || location.hash.startsWith('#project=')
document.body.classList.toggle('showcase-page', !planner && !admin)
if (planner) document.title = 'Forma — room planner'
if (admin) document.title = 'Forma — catalog admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening Forma…</div>}>
      {admin ? <Admin /> : planner ? <App /> : art ? <div style={{ width: '100vw', height: '100dvh' }}><ShowcaseScene art product={art === 'room' ? undefined : art} /></div> : <Showcase />}
    </Suspense>
  </StrictMode>,
)
