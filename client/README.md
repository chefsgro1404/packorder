# ShipScan — Frontend

Next.js 15 (App Router) progressive web app for warehouse staff. Runs on mobile devices as a camera-based barcode scanner. All business logic and Shopify API calls are handled by the Azure Functions backend; this layer contains only UI and thin proxy routes.

## Technology Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19 |
| Styling | Tailwind CSS 3 |
| Barcode scanning | html5-qrcode (camera), dynamic import (SSR-safe) |
| Hardware I/O | Web Serial API (scale + label printer), Chromium-based browsers only |
| QR codes | qrcode.react |
| Icons | lucide-react |
| Deployment | Azure Static Web Apps (Standard tier, standalone output) |

## Application Modes

| Mode | Route | Purpose | Auth required |
|---|---|---|---|
| POS | `/pos` | Scan barcode → product lookup → add to cart → complete draft order | Yes |
| Ship | `/ship` | Browse fulfilled Shopify orders with tracking; scan each product to record shipment; mark as shipped (complete or incomplete with reason); view shipment history with per-scan audit trail | Yes |
| Assign Barcode | `/assign` | Search product variant → scan physical barcode → write to Shopify | Yes |
| Scale & Print | `/scale` | Read weight from a Torrey scale over USB-serial, look up the item's PLU/title in the product lookup table, and auto-print a label (product title + QR code) on a Godex DT2x thermal printer. Every print is logged to a server-side audit table; the last 10 prints can be reprinted from history. | Yes |
| Manage Products | `/scale/products` | Add, edit, and delete the scale item-number → PLU / product title / price-per-lb mappings used by Scale & Print | Yes |

## Project Structure

```
client/
├── app/
│   ├── page.tsx               # Auth state check, login screen, and mode selector
│   ├── pos/page.tsx           # POS mode
│   ├── ship/page.tsx          # Ship mode
│   ├── assign/page.tsx        # Assign Barcode mode
│   ├── scale/page.tsx         # Scale & Print mode (Web Serial)
│   ├── scale/products/page.tsx # Manage Products — CRUD UI for the product lookup table
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
│       ├── shipment/scans/route.ts    # Proxy → GET /api/shipment/scans
│       ├── scale/lookup/route.ts      # Proxy → GET /api/scale/lookup
│       ├── scale/products/route.ts    # Proxy → GET/POST/PATCH/DELETE /api/scale/products
│       └── scale/print-log/route.ts   # Proxy → GET/POST /api/scale/print-log
├── components/
│   ├── BarcodeScanner.tsx     # Camera scanner (html5-qrcode, client-only)
│   ├── CartDrawer.tsx         # POS cart slide-over
│   ├── ModeSelector.tsx       # Home screen mode cards
│   ├── OrderCard.tsx          # Ship order detail card
│   ├── ProductCard.tsx        # POS product result card
│   └── StatusBanner.tsx       # Inline success/error/warning banners
├── hooks/
│   ├── useCart.ts             # Cart state (items, draftOrderId, total)
│   ├── useScanner.ts          # Scan debounce and beep feedback
│   ├── useScale.ts            # Web Serial: scale connection, read loop, silence-based parsing
│   └── usePrinter.ts          # Web Serial: printer connection, EZPL write
├── lib/
│   ├── proxy.ts               # Server-side proxy helper (adds internal secret, forwards cookies)
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── ezpl.ts                # Builds the EZPL byte payload for the Godex DT2x
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

**`/scale` and `/scale/products`** require the same login as every other mode — both call `/api/scale/*` proxy routes, which forward the `access_token` cookie to Functions for validation. `localStorage` is used separately on `/scale` to remember Web Serial port permissions (`shipscale_scale_granted`, `shipscale_printer_granted`) — never auth tokens.

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

## Scale & Print Mode — Hardware Integration

`/scale` connects directly to two USB-serial devices from the browser using the **Web Serial API** (`navigator.serial`). Reading the scale, parsing its output, and writing EZPL to the printer all happen client-side. The product lookup (PLU/title/price by item number) and the print audit log are server-side, via the `/api/scale/*` proxy routes described below. Web Serial is only available in Chromium-based browsers (Chrome, Edge); Safari and Firefox do not implement it.

### Devices

| Device | Connection | Settings |
|---|---|---|
| Torrey scale | USB-to-serial (e.g. COM3) | `baudRate: 9600, dataBits: 8, parity: none, stopBits: 1, flowControl: none` |
| Godex DT2x label printer | USB-serial | `baudRate: 9600`, raw EZPL bytes |

### Connection lifecycle

1. **First use**: the user must click "Connect" for each device in the Device Setup panel. `navigator.serial.requestPort()` opens the browser's port picker — this call only works inside a click handler (browser security requirement).
2. On success, a flag (`shipscale_scale_granted` / `shipscale_printer_granted`) is written to `localStorage` and the port is opened.
3. **Every subsequent visit**: `useScale`/`usePrinter` call `navigator.serial.getPorts()` on mount, which returns ports the browser has already granted — no click required, no port picker shown. The page reconnects silently.
4. Permission persists per browser profile/origin until the user revokes it via the browser's site settings or clears site data, at which point the `localStorage` flag is cleared and the connect buttons reappear.

### Scale read flow (`hooks/useScale.ts`)

1. Staff weighs an item and triggers the scale's transmit sequence (`RCL → 01 → M+`).
2. The scale streams data in several chunks over ~500–1500ms. The hook accumulates every chunk into a buffer.
3. A 50ms poll checks for **2000ms of silence** since the last chunk — once hit, the read is considered complete and the buffer is parsed.
4. `lib/scaleParser.ts` extracts the first line containing `ITEM`, then pulls the item name (`ITEM \d+`), the bare item number (`\d+`), and weight (`\d+\.\d+\s*lb`) via regex. `OVERLOAD` in the buffer is reported as a distinct error.
5. The page looks up the item number against the product lookup table (`GET /api/scale/lookup`). If found, the PLU and product title from the table are used; if not found, a warning is shown and the label prints with a placeholder PLU (`N/A`) and the raw `ITEM N` text as the title.
6. On a successful parse, if the printer is connected the label is printed automatically and logged to the print audit table.

### Product lookup, QR payload & print audit log

- **Product lookup table** (`functions` table `productlookup`): maps a scale item number → PLU, product title, and price-per-lb. Managed entirely from `/scale/products` (add/edit/delete), via `GET/POST/PATCH/DELETE /api/scale/products`.
- **QR payload**: `<PLU> | <Product Title> | <Item Weight> | <Printed At>`, where `<Printed At>` is `lib/dateFormat.ts`'s `formatEst()` output (`yyyy-MM-dd HH:mm:ss`, America/New_York, 24hr) computed at the moment of printing.
- **Print audit log** (`functions` table `printedlabels`): every print (including reprints) is logged via `POST /api/scale/print-log` with the item number, PLU, product title, weight, printed-at timestamp, and the exact QR payload printed. The Print History panel on `/scale` lists the most recent 10 entries from `GET /api/scale/print-log` and can reprint any of them — reprinting re-sends the **original** stored QR payload (so the embedded timestamp reflects the first print) and logs a new audit entry for the reprint event.

### Label printing (`lib/ezpl.ts`)

Builds a raw EZPL command sequence (label height/width, a single text field for the product title, and a QR code encoding the payload above), joined with `\r`-only line endings (no `\n`) and sent as ASCII bytes via `port.writable`.

### Notes / future tuning

- Label dimensions (`^Q`/`^W` in `lib/ezpl.ts`) are currently `38,3` / `57` (57mm × 38mm). If labels print at the wrong size, adjust these two values to match the physical label stock and printer driver configuration.
- The scale parser assumes the Torrey's default `ITEM N $ price weight lb` output format. If the scale firmware/format changes, update the regexes in `lib/scaleParser.ts`.
- The QR payload is longer than the old `<itemName> | <itemWeight>` format — if scanners downstream struggle to read it at the current size/density, increase the QR module size (`W220,10,2,2,...` in `lib/ezpl.ts`) or reduce the error-correction level.

## Notable Implementation Details

**Barcode scanner SSR**: `html5-qrcode` accesses `window` on initialization and cannot be server-rendered. `BarcodeScanner.tsx` uses `next/dynamic(() => import(...), { ssr: false })` to ensure it only loads in the browser.

**Shopify image domains**: Product images are served from `cdn.shopify.com`. This hostname is declared in `next.config.ts` under `images.remotePatterns` so `next/image` can optimize them.

**Variant title display**: When a variant has a meaningful title (anything other than `"Default Title"`), the variant title is shown as the primary label and the product title appears as secondary context. This is consistent across POS, Ship, and Assign modes.

**Cookie forwarding**: `proxy.ts` explicitly copies the `Cookie` header from the incoming Next.js request to the outgoing Functions request. This is necessary because the Functions app runs on a different origin (`azurewebsites.net`), so the browser will not attach cookies to those requests directly. The proxy acts as the authenticated intermediary.
