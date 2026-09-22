# Project context

- Stack: React 19, TypeScript, Vite, React Three Fiber, Drei and Three.js. Use npm.
- `src/App.tsx` owns local editor state, history, catalogue UI and the shopping flow. `src/editor.ts` contains metric placement, opening attachment and validation. `src/SceneEnvironment.tsx` owns the room shell and native catalogue drop projection.
- Room coordinates use metres with Y up; product dimensions in `src/catalog.ts` use centimetres. Rotation is radians around Y. Never scale catalogue dimensions to make products fit.
- This is a local prototype: ten catalogue products (nine authored samples plus one locally registered Polihome extraction), localStorage persistence, URL-fragment sharing, CSV export and downloadable quote drafts. There is no backend, authentication, verified retailer feed, production GLB library or live quote submission. Do not label these as connected services.
- Saved project key: `forma-room-planner-project`. Invalid data must not be silently overwritten; manual save preserves a recovery copy.

# Custom-space building (2026-09-14)

- New projects start with an empty 12 m build grid, no implicit walls, no floor and no furniture. Do not restore template rooms as the default.
- `schemaVersion: 2` uses explicit wall segments. Width/length describe the build grid, not the room. Closed planar wall loops determine floor polygons, including irregular outlines, shared-wall rooms and nested enclosures.
- Walls snap to a 25 cm grid and nearby endpoints/segments. The wall tool remains active across strokes. Escape cancels an unfinished stroke; connected-corner edits update neighbours. Openings use `wallId` and `wallOffset` and follow their parent wall.
- Product movement uses 10 cm snapping when enabled. Full rotated footprints must fit a closed room and not cross a wall. Wall edits preserve furniture and show warnings rather than silently moving products.
- Legacy rectangles are migrated to four explicit boundary walls. Before migration, the original saved JSON is retained under `forma-room-planner-project-before-custom-spaces`.
- Single-floor retail planner only: do not describe this as feature parity with the entire Sims game. Current build grid limit is 40 m; supported saved geometry is capped at 200 walls/openings.

# Verification

- Build and typecheck: `npm run build`.
- Start a test server: `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`.
- Run regression tests: `npm test`. Install the test browser with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium executable. Set `TEST_URL` to test a different running server.
- Production check: `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4173`; run `TEST_URL=http://127.0.0.1:4173 npm test`.
- Browser tests cover filtering, native drop, 2D/3D dragging, history, numeric and keyboard editing, walls/openings, saving, sharing, exports, recovery and mobile panels. Geometry checks live in `editor-model.spec.ts`.
- Inspect screenshots at desktop and 375px widths. The canvas must have nonzero width when both panels collapse; HTML dimension labels must stay below overlays.
- No specs folder or existing project rules were present at the start of the editor work. Use the user's master prompt as the acceptance reference; do not claim the whole marketplace MVP is implemented.

# Render studio (2026-09-15)

- `src/RenderStudio.tsx` is a lazy-loaded, read-only interior view. It renders the actual project, not a generated photograph or replacement demo. Ceiling/camera/exposure settings do not mutate saved room geometry.
- Live preview is rasterized; Path traced uses `three-gpu-pathtracer` 0.0.24 with eight bounces, 256 samples, and its edge-aware denoising pass. Three.js 0.180.0 is required by the tracer. Do not downgrade the tracer to 0.0.23: its public disposal method throws.
- `public/materials/` contains redistributed CC0 Poly Haven assets: `oak-*` is oak_veneer_01, `floor-*` is wood_floor, `linen-*` is denim_fabric (normal/roughness used for illustrative upholstery), and `forest.hdr` is forest_slope at 2K. License: https://polyhaven.com/license. No runtime CDN dependency.
- Window panes use thin-sheet transmission, not solid volume refraction. Window area lights provide sampled daylight fill. The optional ceiling is at the project's ceilingHeight; it is a visualization surface, not new saved architecture.
- Furniture remains authored sample geometry, not production retailer GLBs. Do not claim the reference-photo realism target has been achieved solely because rendering tests pass.
- On macOS, browser tests use full Playwright Chromium with `--use-angle=metal`; the headless-shell SwiftShader backend failed WebGL initialization. Install with `npx playwright install chromium`.
- `npm test -- --grep "render studio|daylight study|unsupported path"` checks render/export, project preservation, unavailable-GPU fallback and desktop/mobile captures. Screenshots are written to `/tmp/forma-studio-desktop-live.png`, `/tmp/forma-studio-desktop-traced.png`, `/tmp/forma-studio-mobile.png`, and `/tmp/forma-editor-mobile.png`.

# Brand showcase (2026-09-16)

- `/` serves `src/Business.tsx`; `/for-shoppers` serves the existing B2C `src/Showcase.tsx` as a hidden direct route. `/for-business` and `/b2b` remain B2B aliases. Root `#project=` links still open the editor. Hosting must rewrite `/planner`, `/for-shoppers`, `/for-business` and `/b2b` to `index.html`. `TEST_URL` is the server origin, not the planner path.
- The showcase is lazy-separated from the editor. Its SVG guided demo does not touch localStorage. Opt-in 3D reuses `ProductModel`; quote drafts use catalogue prices and valid project geometry. Drafts and partnership briefs are local downloads, not purchases or lead submissions.
- Original local showcase JPGs are path-traced from the project's sample models and CC0 surfaces, not retailer photography. Regenerate with the dev server running using `node showcase-assets.mjs`; `/?art=room` and product IDs expose the asset-rendering views. No image-generation service is required.
- `npm test -- showcase.spec.ts` checks the guided journey, totals, downloads, saved-project preservation, shared-link routing, 3D, dialogs and responsive layouts. Full-page captures: `/tmp/forma-showcase-1440.png` and `/tmp/forma-showcase-375.png`.
- The B2B page uses the confirmed inquiry address `info@formivo3d.com` in its mailto links. A lead-submission service, verified retailer data and checkout are still needed before representing these as live capabilities. Do not invent contact details, partnerships, traction or conversion metrics.

# Product ingestion prototype (2026-09-16)

- Run the complete single-product flow with `npm run product:ingest -- --url "https://www.polihome.gr/el/products/Goniakos-kanapes-Vancouver-Gkri-Skouro"`. Use `product:scrape`, `product:model`, `product:validate` and `product:register` for individual stages.
- `scripts/extractors/polihome.ts` uses Playwright-loaded DOM/JSON-LD and interactive colour controls. Raw HTML, page PNG, image downloads, normalized JSON and reports are under ignored `artifacts/products/polihome/vancouver/`.
- Blender is available at `/Applications/Blender.app/Contents/MacOS/Blender`; the procedural job is `scripts/blender/generate-sofa.py`. Generated public GLBs and thumbnails are under `public/catalog/polihome/vancouver/`, and `src/catalog.generated.ts` is regenerated from the normalized product.
- Vancouver v2 is a product-specific photo-authored high-poly reconstruction, not a generic sofa blockout or an automatic arbitrary-product reconstruction algorithm. Three back cushions, a wide seat plus chaise, two loose pillows, low arms, seam geometry, pull straps and upright recessed feet follow the website references. Component measurements not present in the source remain explicitly inferred; human approval and usage permission remain pending.
- The Blender job renders with a temporary Y-up floor/camera/light setup and exports only sofa objects. The original sideways-sofa bug was the export axis conversion, not proof that a default cube was present in the GLB.
- The user confirmed the Vancouver orientation is correct: X is length, Y is vertical height, Z is depth; the footprint is centred on X/Z. This generator deliberately authors Y-up coordinates inside Blender and requires `export_yup=False`. Blender itself is normally Z-up; do not apply this export setting blindly to other assets. Do not add a global 180-degree rotation to the GLB loader. Verify exported GLB axes and floor contact, not only pre-export metadata.
- The user requires product-specific visual fidelity, not generic dimension-matched furniture. High polygon count and passing dimension checks do not establish likeness or hyperrealism. Compare reference photographs and generated views; distinguish measured dimensions, visually inferred details, generated fabric, and human-approved accuracy. Exact fidelity cannot be certified from incomplete photographs alone.
- `npm run product:check` typechecks the TypeScript pipeline. `npm test -- product-model.spec.ts` measures exported GLB vertices/node transforms through Three.js, checks Y=0 floor contact, primary axes, component layout, evaluated triangle counts and embedded material maps. Pre-export metadata is not authoritative validation.
- `npm run product:ingest -- --from-extraction artifacts/products/polihome/vancouver/product.json` replays generation, validation and registration without fetching the retailer again. Comparisons and front/side/rear renders are saved under each artifact variant directory; `comparison.png` includes the original reference and stays private under `artifacts/`.
- Fabric maps are generated from photo-sampled colour, a square fabric-only crop and procedural nap/weave, not measured material scans. Blender's included NumPy performs bulk mesh deformation/UV writes; avoid per-vertex normal recomputation in deformation loops. Catalog GLB/thumbnail URLs include content hashes to invalidate old browser assets.
- Editor regression captures for the detailed sofa: `/tmp/forma-vancouver-detailed-desktop.png` and `/tmp/forma-vancouver-detailed-mobile.png`. Asset generation and validation replace normalized JSON atomically; `product:model --recover-from <snapshot.json>` restores only an empty or missing product file before regenerating.
- Start the controlled catalog API with `npm run admin:server` and open `/admin` through Vite. The API persists jobs under ignored `artifacts/jobs/`, caps jobs at 100 products by default, checks robots/sitemaps, delays requests, deduplicates by existing SKU, and only runs the current Vancouver model recipe. Unsupported products stop as `needs-model-recipe` instead of receiving generic geometry.
- One SKU owns one shared GLB. Colour variants reuse that geometry and provide material colour overrides; do not regenerate identical meshes per colour.

# Deployment (2026-09-17)

- Catalog GLBs/thumbnails are uploaded to the `forma-furniture-marketplace.firebasestorage.app` bucket as public objects (`uploadFile` `{ public: true }` → `publicUrl()`); signed URLs are the fallback. The bucket has a CORS config allowing GET/HEAD from the hosting domains and local dev ports — GLTFLoader fetches cross-origin and fails without it.
- `register-catalog` appends `?v=`/`&v=` content hashes without stripping existing query params, preserving signed URLs.
- `GOOGLE_APPLICATION_CREDENTIALS` points at a firebase-adminsdk key outside the repo. `.env.local` is only auto-loaded by `scripts/admin-server.ts`; CLI pipeline runs need the variable exported in the shell.
- `firebase.json` rewrites both `/api/admin/**` and `/api/worker/**` to Cloud Run `forma-admin-worker`. Cloud Tasks worker delivery requires WORKER_URL/WORKER_TASK_SECRET on the service; a failed enqueue falls back to in-process execution, which Cloud Run CPU throttling can still freeze after the response. A trailing newline in `WORKER_TASK_SECRET` silently 401s every delivery (HTTP headers strip it) — the env var is trimmed in `admin-server`, and the stored secret version must be clean.
- `ImportedProductModel` recolouring must preserve the mesh's material shape: assigning a material array to a single-material mesh (no geometry groups) makes Three.js draw nothing. Clone the scalar material for scalar sources, array for arrays.
- Scanning a product-page URL seeds that URL into discovery (`discoverProductUrls`); a bare domain scan still walks sitemaps/categories only.

# Catalog sources (2026-09-17)

- `scripts/catalog-sources.ts` registers verified retailer/manufacturer sources for existing 3D assets (pivot away from AI generation). Statuses: `exportable-configurator`, `partnership-required`, `materials-source`.
- al2 (`configurator.al2.gr`), HOMAD (`configurator.homad.eu`) and GrecoStrom (`configurator.grecostrom.gr`) all run Unity WebGL configurators by the same vendor (Exact3D/ExactADV Player) with a built-in client-side GLB export: Unity `SendMessage("GameAssetsHandler","SimpleExport")` + `downloadGL(B).js`. Model ids are public `?model=` parameters.
- IKEA, AlfaWood, Xylokat and HIT Fabrics are partnership or materials-only leads — no downloadable furniture GLBs verified. HIT Fabrics' real domain is hitfabrics.com, not hit-fabrics.gr. Never scrape protected planner assets or invent product data for unverified sources.

# Configurator product ingestion (2026-09-17)

- `scripts/ingest-configurator-product.ts` runs the full Exact3D-player product flow: WooCommerce scrape → Unity GLB export → postprocess → Storage upload → validation → registration. Requires `GOOGLE_APPLICATION_CREDENTIALS` exported; `--skip-upload` keeps local paths.
- `scripts/scrape-woocommerce-product.ts` is the generic product-page scraper. Pass the browser-capture function to `page.evaluate` as a **string** — esbuild's `keepNames` transform injects `__name` into function callbacks, which crashes in the page context. Pages without `.product_title`/`h1` (e.g. GrecoStrom) fall back to `og:title`/`document.title` with the site suffix stripped.
- `scripts/postprocess-configurator-glb.ts` inserts a `forma-normalize` root node in the glTF JSON (no re-export): auto unit scale (10×/0.1× when maxDim is implausible), floor snap to Y=0 and X/Z footprint centering via node translation.
- B2B catalog pages (HOMAD, al2, GrecoStrom) expose no public price/dims/SKU — fields stay `null`, measured GLB dims fill `dimensionsCm` (rounded to cm) with a "measured from retailer 3D model" warning; `modelAsset.generationMethod` records the configurator host and `visualAccuracy` stays `pending-human-review`.
- `register-catalog` dedupe bug: `sku: null` records collided (`item.sku !== record.sku` dropped previous null-SKU products). Filter by SKU only when non-null.
- `validate-model` Vancouver material names are gated to that product id; other products just require ≥1 material. The shared-GLB check still requires `generationStatus: 'generated'` + `validationStatus: 'validated'`.
- Verified pilots: `homad-canova` (369×183×92, 155k tris), `al2-prism-dining-table` (240×124×74, 7k tris), `grecostrom-krevati-ermis` (159×185×102 — mm-as-m export fixed by 0.1 scale). All render on-floor centered in the editor.

# Drawing import (2026-09-22)

- `src/planImport.ts` extracts filled axis-aligned wall bands locally, including thinner/fainter bands connected to strong walls. Never generate a bounding rectangle as a fallback or infer metre dimensions from an unscaled raster.
- Import is explicitly WIP and best-effort, and the editor hides its entry points until the flow is polished. When re-enabled, users can create the space after entering scale without reviewing symbols or checking a confirmation box. Suggested opening types are used automatically; unknown gaps stay open. Overlay corrections are optional. Changes remain one Undo step; furniture stays deferred.
- Wall features have optional `thickness` in metres (0.02–2); old projects default to 0.12 via `wallThickness`. Import scales detected pixel thicknesses. Rendering, opening frames, skirting, window light offsets, furniture clearance and wall snapping use the actual thickness; edits/history/save must preserve it.
- This is assisted reconstruction, not certified architectural recognition. Diagonal/outline-only walls and ambiguous symbols need correction or a better source. Passing geometry tests does not establish accuracy on arbitrary drawings.
- Targeted checks: `npm test -- editor-model.spec.ts editor.spec.ts --grep "plan extraction|plan openings|wall thickness|architectural drawing import|WIP drawing"`. Review screenshots: `/tmp/forma-plan-review-1440.png` and `/tmp/forma-plan-review-375.png`.
