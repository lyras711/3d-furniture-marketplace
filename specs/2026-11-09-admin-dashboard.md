# Admin management dashboard (2026-11-09)

Goal: one `/admin` dashboard to manage B2C orders, B2B retailer partners and catalogue furniture. Builds on the existing admin (purchase queue, ingestion, roles, audit).

## Decisions (user-confirmed)
- Modules: Orders (B2C lifecycle), B2B pipeline, Furniture catalogue. Customers & designs deferred.
- B2B = **retailer partners** (brands/retailers that list products or embed the planner). Admin-only entry; the public business page keeps `mailto:`. No public lead form yet.
- Catalogue: name, price and dimensions will come from partners, so admins **only** change visibility and human-review state. The old rename action is removed.
- Layout: tabbed sections under one dashboard (`?tab=`): Overview, Orders, Partners, Catalogue, Ingestion, Team.
- Production: `vercel.json` rewrites `/api/*` to Cloud Run `forma-admin-worker` (was 404 on formivo3d.com).

## Orders
- Statuses: `pending → awaiting-user-decision | ready-to-place → placed → delivered`; `returned-for-revision` (customer). Admin can cancel any active or placed order with a customer-visible reason.
- `adminTransitionAllowed` in `src/purchase.ts` is the single rule table. Every change appends to `history`. Internal `adminNotes` are never returned by `/api/account/**`.
- Still manual: no payment, no retailer API, no email notification.

## Catalogue
- `catalogEdits/{productId}`: `hidden`, `review` (`pending|approved|needs-work`). Legacy `deletedAt` counts as hidden.
- Public `GET /api/catalog/visibility` returns hidden ids only. The planner drops hidden items from the catalogue, Add sheet and similar strip; saved designs still render them. New purchase requests refuse hidden items.

## Partners
- `partners/{id}`: company, website, country, contact, `retailerId` link to catalogue, stage `lead|contacted|negotiating|onboarding|active|paused|lost`, notes, stage history. Validation in `src/partners.ts`.

## Roles
- viewer: overview, catalogue, ingestion (read). editor: review state, ingestion jobs. admin/owner: orders, partners, visibility, team, audit.

Related: [[2026-11-08-mobile-simplicity-plan]]

## Firebase / GCP hardening (2026-11-09, later)
- Production had blank `VITE_FIREBASE_*` in Vercel, so `/profile` and `/admin` could not sign in on formivo3d.com. Fixed and rebuilt.
- Done: authorized domains, anonymous auth, password policy, App Check (reCAPTCHA Enterprise), Vertex AI, deny-all Firestore/Storage rules (public `catalog/**` read), PITR, least-privilege `formivo-api` Cloud Run SA, verified-email requirement for `ADMIN_EMAILS` owners, reset/verify emails, Vercel-only hosting.
- Open: custom email sender domain (needs DNS), Firebase public-facing app name in email templates, removing Editor from the default compute SA, budget alerts, EU Storage bucket.

## Catalogue detail and retailer metadata crawl (2026-11-16)
- Catalogue rows open `/admin/catalog/:id`, which shows the product record, extracted attributes, source images, warnings, missing fields, and current GLB. Names, dimensions, and pricing remain read-only.
- Admins can preview a selected `.glb` locally, then upload it (18 MiB maximum). The server validates the GLB 2.0 JSON chunk and stores it at `catalog/<brand>/<product>/models/<sha256>.glb`; `catalogEdits` carries the active model URL and uploader metadata.
- Each product variant can have its own PNG, JPEG, or WebP texture (10 MiB maximum), stored by content hash under the variant's brand/product folder and overlaid from `catalogEdits.variantTextures`. The detail page previews the texture on the selected GLB material; uploads must match that material's UV layout.
- The Ingestion tab starts metadata-and-image-only crawls. It discovers same-host product URLs from sitemaps or shop/category links, observes robots.txt, rate-limits requests, and stores product metadata in `catalogProducts`. It does not generate GLBs. New crawl results start hidden and need positive dimensions plus an uploaded GLB before they can be listed.
- Images are stored at `catalog/<brand>/<product>/images/<sha256>.<ext>` with immutable one-year cache headers. `GET /api/catalog/products` feeds the editor; startup loads it before validating projects, resolves hidden items for existing projects, and lazy-loads product thumbnails.
- Crawl limits are 500 product pages and at least a one-second delay. Sites that block robots access or use nonstandard product URL structures may need a retailer-specific discovery adapter; crawled fields still require human review.
