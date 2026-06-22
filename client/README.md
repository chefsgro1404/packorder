# ShipScan — Frontend

Next.js 15 (App Router) progressive web app for warehouse staff. Runs on mobile devices as a camera-based barcode scanner. All business logic and Shopify API calls are handled by the Azure Functions backend; this layer contains only UI and thin proxy routes.

## Technology Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19 |
| Styling | Tailwind CSS 3 |
| Barcode scanning | html5-qrcode (camera), dynamic import (SSR-safe) |
| Hardware I/O | Web Serial API (scale only), Chromium-based browsers only — labels print via the browser's native print dialog to a Godex DT2x configured as a Windows/macOS printer |
| QR codes | qrcode.react |
| Icons | lucide-react |
| Deployment | Azure Static Web Apps (Standard tier, standalone output) |

## Application Modes

| Mode | Route | Purpose | Auth required |
|---|---|---|---|
| POS | `/pos` | Scan barcode → product lookup → add to cart → complete draft order | Yes |
| Ship | `/ship` | Browse fulfilled Shopify orders with tracking; scan each product to record shipment; mark as shipped (complete or incomplete with reason); view shipment history with per-scan audit trail | Yes |
| Assign Barcode | `/assign` | Browse/filter products (vendor, status, barcode status, collection) → scan physical barcode → write to Shopify. Every assignment, removal, or rescan is logged to a server-side audit trail viewable in the collapsible Assign History panel. The filtered product list can be exported as CSV or a print-ready PDF view. | Yes |
| Scale & Print | `/scale` | Read weight from a Torrey scale over USB-serial, look up the item's PLU/title by scale item number, and auto-print a label (product title + QR code) via the browser's print dialog on a Godex DT2x. Every print is logged to a server-side audit table; the last 10 prints can be reprinted from history. A "Select Product" entry point opens the product picker for items that don't have (or don't need) a saved item-number slot. | Yes |
| Select Product | `/scale/products` | Search the synced Shopify catalog or browse already-saved scale mappings (pinned ones first) to open a specific product's detail page. Also supports the legacy slot-only form (item number → PLU/title/price, with no Shopify product attached). | Yes |
| Product Detail (Scale) | `/scale/products/[id]` | View/edit a product's optional scale item-number slot, PLU (writes back to Shopify), price-per-lb, and pin status. While this page is open, **any** weight reading from the scale prints a label for this product immediately, regardless of what item number the scale itself reports — lets staff print several labels for the same product back-to-back. | Yes |

## Project Structure

```
client/
├── app/
│   ├── page.tsx               # Auth state check, login screen, and mode selector
│   ├── pos/page.tsx           # POS mode
│   ├── ship/page.tsx          # Ship mode
│   ├── assign/page.tsx        # Assign Barcode mode
│   ├── scale/page.tsx         # Scale & Print mode (Web Serial) — item-number-driven auto-print + "Select Product" entry
│   ├── scale/products/page.tsx       # Select Product — catalog search, saved/pinned mappings, legacy slot-only form
│   ├── scale/products/[id]/page.tsx  # Product detail (variant ID route) — edit mapping, lock-and-auto-print on any weight signal
│   └── api/
│       ├── auth/route.ts      # Proxy → GET/POST/DELETE /api/auth
│       ├── auth/refresh/route.ts # Proxy → POST /api/auth/refresh
│       ├── product/route.ts   # Proxy → GET /api/product
│       ├── products/route.ts          # Proxy → GET /api/products
│       ├── products/variant/route.ts  # Proxy → GET /api/products/variant
│       ├── order/route.ts     # Proxy → GET /api/order
│       ├── draft-order/route.ts # Proxy → POST /api/draft-order
│       ├── fulfill/route.ts   # Proxy → POST /api/fulfill
│       ├── variant/route.ts   # Proxy → GET/PATCH /api/variant
│       ├── ship-orders/route.ts       # Proxy → GET /api/ship-orders
│       ├── ship-orders/lookup/route.ts # Proxy → GET /api/ship-orders/lookup
│       ├── sync/ship-orders/route.ts  # Proxy → POST /api/sync/ship-orders
│       ├── shipment/scan/route.ts     # Proxy → POST /api/shipment/scan
│       ├── shipment/complete/route.ts # Proxy → POST /api/shipment/complete
│       ├── shipment/history/route.ts  # Proxy → GET /api/shipment/history
│       ├── shipment/scans/route.ts    # Proxy → GET /api/shipment/scans
│       ├── scale/lookup/route.ts      # Proxy → GET /api/scale/lookup
│       ├── scale/products/route.ts    # Proxy → GET/POST/PATCH/DELETE /api/scale/products
│       ├── scale/products/by-variant/route.ts # Proxy → GET/PUT/DELETE /api/scale/products/by-variant
│       └── scale/print-log/route.ts   # Proxy → GET/POST /api/scale/print-log
├── components/
│   ├── BarcodeScanner.tsx     # Camera scanner (html5-qrcode, client-only)
│   ├── CartDrawer.tsx         # POS cart slide-over
│   ├── ModeSelector.tsx       # Home screen mode cards
│   ├── OrderCard.tsx          # Ship order detail card
│   ├── ProductCard.tsx        # POS product result card
│   ├── PrintLabelPortal.tsx   # Hidden print-only DOM + @media print styles, shared by /scale and /scale/products/[id]
│   └── StatusBanner.tsx       # Inline success/error/warning banners
├── hooks/
│   ├── useCart.ts             # Cart state (items, draftOrderId, total)
│   ├── useScanner.ts          # Scan debounce and beep feedback
│   ├── useScale.ts            # Web Serial: scale connection, read loop, silence-based parsing
│   └── usePrintLabel.ts       # Builds a QR label payload, opens the browser print dialog; shared by /scale and /scale/products/[id]
├── lib/
│   ├── proxy.ts               # Server-side proxy helper (adds internal secret, forwards cookies)
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── scaleLabel.ts          # generateSn() / buildQrPayload() — shared QR payload builder
│   ├── scaleParser.ts         # Parses raw Torrey scale output into item number/weight
│   └── dateFormat.ts          # Formats a Date as "yyyy-MM-dd HH:mm:ss" in America/New_York, 24hr
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

**`/scale`, `/scale/products`, and `/scale/products/[id]`** require the same login as every other mode — all call `/api/scale/*` proxy routes, which forward the `access_token` cookie to Functions for validation. `localStorage` is used separately on `/scale` and `/scale/products/[id]` to remember the scale's Web Serial port permission (`shipscale_scale_granted`) — never auth tokens.

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

## Ship Mode — Sync Date Range & Order Search

**Sync**: The filter icon next to the sync (refresh) button on the Active tab opens a date-range panel ("Fulfilled from" / "Fulfilled to"). Tapping **Sync** with both fields empty syncs only orders fulfilled **today**; setting a date or range syncs/persists fulfillments whose Shopify fulfillment date falls within that range instead. Only fulfilled/partial, non-POS orders with tracking info are ever synced — see `POST /api/sync/ship-orders` in the backend README.

**Search**: The search bar filters the locally-loaded list as you type. If no local results match and you press Enter (or tap "Search Shopify for…"), the app calls `GET /api/ship-orders/lookup?ref=<query>` to look the order up directly in Shopify by name or tag:
- Not found → a warning banner ("Order not found")
- Found but unfulfilled, or fulfilled/partial without tracking → a warning banner explaining why it isn't shippable yet
- Found and eligible (fulfilled/partial, non-POS, has tracking) → the order is added to the Active list and persisted to the `fulfillmentshipments` table for future loads

## Assign Mode — Filters, Export & Audit Trail

**Filters**: the product browser on `/assign` supports Barcode status (All/Has barcode/No barcode), Status (Active/Draft/Archived), Vendor, and a single "Collections" dropdown. Each collection in that dropdown cycles through three states on repeated taps — unselected → include (green check) → exclude (red X) → unselected — so one UI control drives both "must be in any of these" and "must not be in any of these" simultaneously (e.g. include "Summer" while excluding "Clearance" in the same dropdown). Vendor and Collection options are populated from the locally cached product catalogue (synced from Shopify via the sync button) — collection membership is fetched as part of that same sync, so a product can match multiple collections.

**Export**: the Export button exports the *entire* filtered set (not just the loaded page) via `GET /api/products/export`, applying the same filters as the on-screen list. **Export CSV** downloads a file with one row per variant (Product Title, Variant Title, SKU, Barcode — blank if unset, Vendor, Status, Collections). **Export PDF** opens a clean, print-formatted table in a new browser tab and triggers the print dialog — use "Save as PDF" there. This is intended for handing a colleague a list of products still missing barcodes (filter by "No barcode", optionally narrow by vendor/collection, then export).

**Assign History**: every barcode write — add, change, removal, or rescan of the same value — is logged server-side with who made the change and the old/new barcode values. The collapsible "Assign History" panel at the bottom of the product list (`GET /api/variant/audit`) shows this trail, color-coded by action (added/changed/removed/rescanned).

## Scale & Print Mode — Hardware Integration

`/scale` and `/scale/products/[id]` connect to the Torrey scale from the browser using the **Web Serial API** (`navigator.serial`). Reading and parsing the scale's output happens client-side; labels print through the browser's own print dialog rather than a raw serial write, so the Godex DT2x is set up as a normal OS-level printer (USB or driver-installed) and any browser print target works. The product lookup/mapping and the print audit log are server-side, via the `/api/scale/*` and `/api/products/*` proxy routes described below. Web Serial is only available in Chromium-based browsers (Chrome, Edge); Safari and Firefox do not implement it.

### Devices

| Device | Connection | Settings |
|---|---|---|
| Torrey scale | USB-to-serial (e.g. COM3), read via Web Serial | `baudRate: 9600, dataBits: 8, parity: none, stopBits: 1, flowControl: none` |
| Godex DT2x label printer | OS-level printer (no Web Serial) | Browser print dialog, `@page { size: 3in 2in; margin: 0 }` |

### Connection lifecycle

1. **First use**: the user must click "Connect" in the Device Setup panel on `/scale` (or it auto-connects on `/scale/products/[id]` if already granted). `navigator.serial.requestPort()` opens the browser's port picker — this call only works inside a click handler (browser security requirement).
2. On success, a flag (`shipscale_scale_granted`) is written to `localStorage` and the port is opened.
3. **Every subsequent visit**: `useScale` calls `navigator.serial.getPorts()` on mount, which returns ports the browser has already granted — no click required, no port picker shown. The page reconnects silently. This applies on both `/scale` and `/scale/products/[id]` — each page calls `useScale` independently.
4. Permission persists per browser profile/origin until the user revokes it via the browser's site settings or clears site data, at which point the `localStorage` flag is cleared and the connect button reappears.

### Scale read flow (`hooks/useScale.ts`)

1. Staff weighs an item and triggers the scale's transmit sequence (`RCL → 01 → M+`).
2. The scale streams data in several chunks over ~500–1500ms. The hook accumulates every chunk into a buffer.
3. A 50ms poll checks for **2000ms of silence** since the last chunk — once hit, the read is considered complete and the buffer is parsed.
4. `lib/scaleParser.ts` extracts the first line containing `ITEM`, then pulls the item name (`ITEM \d+`), the bare item number (`\d+`), and weight (`\d+\.\d+\s*lb`) via regex. `OVERLOAD` in the buffer is reported as a distinct error.
5. **On `/scale`**: the page looks up the item number against `GET /api/scale/lookup`. If found, the PLU and product title from the matching row are used; if not found, a warning is shown and the label prints with a placeholder PLU (`N/A`) and the raw `ITEM N` text as the title.
6. **On `/scale/products/[id]`**: the item number reported by the reading is ignored entirely — the page is "locked" to whichever product its route was opened for, so every reading prints a label for that product using only the weight from the reading. This lets staff print several physical units of the same product back-to-back without re-selecting it.
7. Either way, a successful parse immediately opens the browser's print dialog via `usePrintLabel`/`PrintLabelPortal` and logs the print to the audit table.

### Product mapping, QR payload & print audit log

- **Product mapping** (`functions` table `productlookup`, one table for two row shapes): legacy rows keyed by scale item number (`itemNumber → PLU / product title / price-per-lb`, managed from the "Slot Only" form on `/scale/products`, via `GET/POST/PATCH/DELETE /api/scale/products`), and product-centric rows keyed by Shopify variant (managed from `/scale/products/[id]`, via `GET/PUT/DELETE /api/scale/products/by-variant`). The item-number slot is always optional on the variant-keyed rows — most products are expected to have no slot at all, since the scale has far fewer programmable PLU slots than there are SKUs. A `pinned` flag (toggle on either page) sorts a row to the top of the list on `/scale/products`. Editing the PLU on `/scale/products/[id]` also writes the variant's barcode in Shopify and logs a `barcodeaudits` entry, the same audit path `/assign` uses.
- **QR payload**: `<PLU> | <Product Title> | <Item Weight> | <Printed At> | SN:<sn>`, where `<Printed At>` is `lib/dateFormat.ts`'s `formatEst()` output (`yyyy-MM-dd HH:mm:ss`, America/New_York, 24hr) computed at the moment of printing, and `<sn>` is a fresh random serial generated per print (reused as-is on reprint, so Ship mode's duplicate-scan detection recognizes a reprinted label as the same physical unit).
- **Print audit log** (`functions` table `printedlabels`): every print (including reprints) is logged via `POST /api/scale/print-log` with the item number (if any), PLU, product title, weight, printed-at timestamp, and the exact QR payload printed. The Print History panel on `/scale` lists the most recent 10 entries from `GET /api/scale/print-log` and can reprint any of them — reprinting re-sends the **original** stored QR payload and serial number (so the embedded timestamp and `sn` reflect the first print) and logs a new audit entry for the reprint event.

### Label printing (`hooks/usePrintLabel.ts` + `components/PrintLabelPortal.tsx`)

`usePrintLabel` builds the QR payload (`lib/scaleLabel.ts`'s `generateSn()`/`buildQrPayload()`), renders it into a hidden `#print-label` DOM node via `PrintLabelPortal`, then opens a new blank window, writes that node's HTML plus print-only CSS into it, and calls `window.print()`. The window closes itself on `onafterprint`. This is shared verbatim between `/scale` and `/scale/products/[id]` so both pages print an identical 3in × 2in label.

### Notes / future tuning

- Label layout (size, QR module size, font sizes) lives in `components/PrintLabelPortal.tsx` and the inline print-window styles in `hooks/usePrintLabel.ts` — both must be kept in sync if the label design changes.
- The scale parser assumes the Torrey's default `ITEM N $ price weight lb` output format. If the scale firmware/format changes, update the regexes in `lib/scaleParser.ts`.
- The print flow depends on the OS/browser having a print target (physical printer or "Save as PDF") configured — there is no raw serial/EZPL fallback if no print target is available.

## Notable Implementation Details

**Barcode scanner SSR**: `html5-qrcode` accesses `window` on initialization and cannot be server-rendered. `BarcodeScanner.tsx` uses `next/dynamic(() => import(...), { ssr: false })` to ensure it only loads in the browser.

**Shopify image domains**: Product images are served from `cdn.shopify.com`. This hostname is declared in `next.config.ts` under `images.remotePatterns` so `next/image` can optimize them.

**Variant title display**: When a variant has a meaningful title (anything other than `"Default Title"`), the variant title is shown as the primary label and the product title appears as secondary context. This is consistent across POS, Ship, and Assign modes.

**Cookie forwarding**: `proxy.ts` explicitly copies the `Cookie` header from the incoming Next.js request to the outgoing Functions request. This is necessary because the Functions app runs on a different origin (`azurewebsites.net`), so the browser will not attach cookies to those requests directly. The proxy acts as the authenticated intermediary.
