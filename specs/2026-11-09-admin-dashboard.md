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
