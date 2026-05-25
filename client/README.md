# ShipScan — Frontend

Next.js 15 (App Router) progressive web app for warehouse staff. Runs on mobile devices as a camera-based barcode scanner. All business logic and Shopify API calls are handled by the Azure Functions backend; this layer contains only UI and thin proxy routes.

## Technology Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19 |
| Styling | Tailwind CSS 3 |
| Barcode scanning | html5-qrcode (camera), dynamic import (SSR-safe) |
| Icons | lucide-react |
| Deployment | Azure Static Web Apps (Standard tier, standalone output) |

## Application Modes

| Mode | Route | Purpose |
|---|---|---|
| POS | `/pos` | Scan barcode → product lookup → add to cart → complete draft order |
| Ship | `/ship` | Browse fulfilled Shopify orders with tracking; scan each product to record shipment; mark as shipped (complete or incomplete with reason); view shipment history with per-scan audit trail |
| Assign Barcode | `/assign` | Search product variant → scan physical barcode → write to Shopify |

## Project Structure

```
client/
├── app/
│   ├── page.tsx               # Auth state check, login screen, and mode selector
│   ├── pos/page.tsx           # POS mode
│   ├── ship/page.tsx          # Ship mode
│   ├── assign/page.tsx        # Assign Barcode mode
│   └── api/
│       ├── auth/route.ts      # Proxy → GET/POST/DELETE /api/auth
│       ├── auth/refresh/route.ts # Proxy → POST /api/auth/refresh
│       ├── product/route.ts   # Proxy → GET /api/product
│       ├── order/route.ts     # Proxy → GET /api/order
│       ├── draft-order/route.ts # Proxy → POST /api/draft-order
│       ├── fulfill/route.ts   # Proxy → POST /api/fulfill
│       ├── variant/route.ts   # Proxy → GET/PATCH /api/variant
│       ├── ship-orders/route.ts       # Proxy → GET /api/ship-orders
│       ├── sync/ship-orders/route.ts  # Proxy → POST /api/sync/ship-orders
│       ├── shipment/scan/route.ts     # Proxy → POST /api/shipment/scan
│       ├── shipment/complete/route.ts # Proxy → POST /api/shipment/complete
│       ├── shipment/history/route.ts  # Proxy → GET /api/shipment/history
│       └── shipment/scans/route.ts    # Proxy → GET /api/shipment/scans
├── components/
│   ├── BarcodeScanner.tsx     # Camera scanner (html5-qrcode, client-only)
│   ├── CartDrawer.tsx         # POS cart slide-over
│   ├── ModeSelector.tsx       # Home screen mode cards
│   ├── OrderCard.tsx          # Ship order detail card
│   ├── ProductCard.tsx        # POS product result card
│   └── StatusBanner.tsx       # Inline success/error/warning banners
├── hooks/
│   ├── useCart.ts             # Cart state (items, draftOrderId, total)
│   └── useScanner.ts          # Scan debounce and beep feedback
├── lib/
│   ├── proxy.ts               # Server-side proxy helper (adds internal secret, forwards cookies)
│   └── types.ts               # Shared TypeScript interfaces
└── public/
    └── manifest.json          # PWA manifest
```

## Authentication Flow

Auth tokens are stored in httpOnly cookies. JavaScript on the page cannot read them — the browser attaches them automatically on every request to the same origin.

1. **Session check on load**: `page.tsx` sends `GET /api/auth` on mount. Functions validates the `access_token` cookie and returns `{ authenticated: true, userId }` or `{ authenticated: false }`. The login screen or mode selector is shown accordingly.
2. **Login**: Staff enters email and password. `POST /api/auth { email, password }` is proxied to Functions. On success, Functions sets two httpOnly cookies in its response: `access_token` (24-hour lifetime) and `refresh_token` (30-day lifetime). The proxy forwards both `Set-Cookie` headers to the browser.
3. **Subsequent requests**: The browser sends cookies automatically. `proxy.ts` reads the `Cookie` header from the incoming browser request and forwards it to Functions. Functions reads the `access_token` cookie, validates the JWT signature and expiry, then checks the JTI against the revocation table.
4. **Token refresh**: `POST /api/auth/refresh` validates the `refresh_token` cookie and issues a new `access_token` cookie without requiring credentials again.
5. **Logout**: `DELETE /api/auth` revokes both token JTIs in Azure Table Storage and responds with `Max-Age=0` on both cookies, instructing the browser to delete them immediately.

No tokens are ever stored in `localStorage` or `sessionStorage`. No `Authorization` header is used. No Shopify credentials or internal secrets ever reach the browser.

## Proxy Route Pattern

Each API route in `app/api/` is a thin proxy implemented via `lib/proxy.ts`:

```
Client page  →  fetch("/api/product?barcode=...")  →  Next.js route handler
                                                            │
                                             adds X-Internal-Secret header
                                             forwards Cookie header from browser
                                             forwards query params + body
                                                            │
                                                            ▼
                                              Azure Functions /api/product
                                                            │
                                             forwards Set-Cookie headers back
                                                            │
                                                            ▼
                                                      Browser
```

The proxy forwards `Set-Cookie` response headers from Functions back to the browser using `Headers.getSetCookie()`, ensuring auth cookies are updated transparently (e.g. after token refresh).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_FUNCTIONS_URL` | Yes | Base URL of the Azure Functions app, e.g. `https://shipscan-api-prod.azurewebsites.net` |
| `INTERNAL_API_SECRET` | Yes | Shared secret added to every proxied request as `X-Internal-Secret`. Must match the Functions app setting. |
| `NEXT_PUBLIC_APP_NAME` | No | App display name. Defaults to `ShipScan`. |

These are server-side variables (no `NEXT_PUBLIC_` prefix except `APP_NAME`). They are never bundled into client-side JavaScript.

For local development, set values in `client/.env.local`:

```
AZURE_FUNCTIONS_URL=http://localhost:7071
INTERNAL_API_SECRET=dev-internal-secret
NEXT_PUBLIC_APP_NAME=ShipScan
```

`.env.local` is gitignored. It contains no Shopify credentials or JWT secrets — those live exclusively in Azure Key Vault and are read by the Functions backend.

## Local Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (standalone)
npm run lint       # ESLint
npx tsc --noEmit   # TypeScript type check
```

The Functions backend must be running at `AZURE_FUNCTIONS_URL` before making API calls. See the backend README for local setup. Cookies work on `localhost` without the `Secure` flag; in production the `CookieSecure` Functions app setting is set to `true` to enforce HTTPS-only cookie transmission.

## PWA Configuration

The app is configured as an installable PWA via `public/manifest.json` and meta tags in `app/layout.tsx`. It is locked to portrait orientation and disables user scaling. Camera access requires HTTPS in production; `localhost` is exempt.

## Ship Mode — Staff Name

Ship mode reads and writes the staff name to `localStorage` under the key `shipscan_staff_name`. On first visit, a bottom-sheet prompt asks for the staff name before shipping can begin. The name is pre-filled in the completion modal and recorded on every `ShipmentScanEntity` and `FulfillmentShipmentEntity` written to Table Storage. To change the name, tap the name chip in the top-left of the Ship list screen.

## Notable Implementation Details

**Barcode scanner SSR**: `html5-qrcode` accesses `window` on initialization and cannot be server-rendered. `BarcodeScanner.tsx` uses `next/dynamic(() => import(...), { ssr: false })` to ensure it only loads in the browser.

**Shopify image domains**: Product images are served from `cdn.shopify.com`. This hostname is declared in `next.config.ts` under `images.remotePatterns` so `next/image` can optimize them.

**Variant title display**: When a variant has a meaningful title (anything other than `"Default Title"`), the variant title is shown as the primary label and the product title appears as secondary context. This is consistent across POS, Ship, and Assign modes.

**Cookie forwarding**: `proxy.ts` explicitly copies the `Cookie` header from the incoming Next.js request to the outgoing Functions request. This is necessary because the Functions app runs on a different origin (`azurewebsites.net`), so the browser will not attach cookies to those requests directly. The proxy acts as the authenticated intermediary.
