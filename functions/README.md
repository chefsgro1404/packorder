# ShipScan — Backend (Azure Functions)

.NET 8 isolated worker Azure Functions application. Handles all Shopify Admin API calls, email + password authentication, JWT issuance and validation, token revocation, and audit logging. Secrets are read from Azure Key Vault via app settings references. Storage access uses Managed Identity — no connection strings in code.

## Technology Stack

| Concern | Choice |
|---|---|
| Runtime | .NET 8, Azure Functions v4, Isolated Worker |
| Shopify integration | Raw `HttpClient` + GraphQL Admin API 2025-01 |
| Authentication | HMAC-SHA256 JWT (`System.IdentityModel.Tokens.Jwt`), httpOnly cookies |
| Storage | Azure Table Storage via `Azure.Data.Tables` |
| Identity | `Azure.Identity.DefaultAzureCredential` |
| Serialization | Newtonsoft.Json 13 |
| Testing | xUnit 2, Moq 4 |

## Project Structure

```
functions/
├── Functions/
│   ├── AuthFunction.cs        # GET /api/auth (check), POST (login), POST /api/auth/refresh, DELETE (logout)
│   ├── ProductFunction.cs     # GET /api/product?barcode=
│   ├── OrderFunction.cs       # GET /api/order?ref=
│   ├── DraftOrderFunction.cs  # POST /api/draft-order (create/add-item/complete)
│   ├── FulfillFunction.cs     # POST /api/fulfill
│   ├── VariantFunction.cs     # GET /api/variant?q=, PATCH /api/variant
│   ├── HealthFunction.cs      # GET /api/health (exempt from auth middleware)
│   ├── SyncShipOrdersFunction.cs  # POST /api/sync/ship-orders (pull fulfilled orders from Shopify)
│   ├── ShipOrdersFunction.cs      # GET /api/ship-orders (list pending shipments)
│   ├── ShipmentFunction.cs        # POST /api/shipment/scan, POST /api/shipment/complete, GET /api/shipment/history, GET /api/shipment/scans
│   └── ScaleFunction.cs           # GET /api/scale/lookup, GET/POST/PATCH/DELETE /api/scale/products, GET/POST /api/scale/print-log
├── Helpers/
│   ├── AuthHelper.cs          # Reads access_token cookie, validates JWT + JTI revocation
│   ├── CorsHelper.cs          # CORS preflight and response header injection
│   └── ResponseHelper.cs      # Writes { success, data } / { success, error } envelopes
├── Middleware/
│   └── InternalSecretMiddleware.cs  # Validates X-Internal-Secret on every request
├── Models/
│   └── ShipScanModels.cs      # All request/response and entity models (incl. RevokedTokenEntity)
├── Services/
│   ├── AuthService.cs         # Credential validation (email + password), JWT generation/validation (access + refresh)
│   ├── ShopifyService.cs      # All Shopify Admin GraphQL operations
│   └── TableStorageService.cs # Azure Table Storage: audit log + revoked token JTIs
├── host.json
├── local.settings.json        # Local development settings (gitignored — never commit)
└── ShipScan.Functions.csproj
```

## Security Model

### Request authentication (two layers)

Every request (except `GET /api/health`) must pass both checks in order:

1. **`InternalSecretMiddleware`** — validates `X-Internal-Secret` header against the `InternalApiSecret` app setting. Rejects with 401 any request that did not originate from the SWA proxy layer.

2. **`AuthHelper.ValidateRequest`** — called at the start of each protected function. Reads the `access_token` httpOnly cookie, validates the JWT signature using HMAC-SHA256 (`JwtSecret`), checks issuer, audience, and expiry, then verifies the token's JTI (JWT ID) has not been revoked in the `revokedtokens` Table Storage table.

```
Request
  │
  ├─ InternalSecretMiddleware (pipeline-level, all routes)
  │      Reject 401 if X-Internal-Secret is missing or wrong
  │
  └─ AuthHelper.ValidateRequest (per-function)
         Read access_token cookie
         Reject 401 if cookie missing, JWT invalid, expired, or tampered
         Reject 401 if JTI is in the revokedtokens table
         Return (userId, jti) on success
```

### Token design

Every token (access and refresh) carries a `jti` claim set to a new `Guid` at generation time. Access tokens use `JwtSecret`; refresh tokens use a separate `JwtRefreshSecret`. A token signed with one key cannot validate against the other, preventing cross-token substitution attacks.

| Token | Cookie name | Lifetime | Secret used |
|---|---|---|---|
| Access | `access_token` | 24 hours | `JwtSecret` |
| Refresh | `refresh_token` | 30 days | `JwtRefreshSecret` |

Both cookies are set with `HttpOnly; SameSite=None; Path=/` (and `Secure` in production). JavaScript on the page cannot read them.

### JTI revocation

On logout, both the access token JTI and the refresh token JTI are written to the `revokedtokens` Azure Table Storage table as `RevokedTokenEntity` records. `AuthHelper.ValidateRequest` checks this table on every request after signature validation. Revoked token records store an `ExpiresAt` timestamp so entries can be cleaned up after the token's natural expiry.

### Secret management

All secrets are stored in Azure Key Vault and surfaced as app settings using the `@Microsoft.KeyVault(VaultName=...;SecretName=...)` reference syntax. The Functions app identity is granted `Key Vault Secrets User` role via RBAC. No secrets appear in source code or deployment artifacts.

| App Setting | Key Vault Secret | Description |
|---|---|---|
| `ShopifyStoreDomain` | `ShopifyStoreDomain` | Shopify store hostname |
| `ShopifyAccessToken` | `ShopifyAccessToken` | Admin API access token |
| `AppEmail` | `AppEmail` | Staff login email address |
| `AppPassword` | `AppPassword` | Staff login password |
| `JwtSecret` | `JwtSecret` | ≥64-character key for HMAC-SHA256 access token signing |
| `JwtRefreshSecret` | `JwtRefreshSecret` | ≥64-character key for HMAC-SHA256 refresh token signing |
| `InternalApiSecret` | `InternalApiSecret` | Shared secret with the SWA proxy |

### Storage access

`TableServiceClient` is constructed with `DefaultAzureCredential` and the storage account URI. No connection strings or storage account keys are used. The Functions app identity must be granted `Storage Table Data Contributor` on the storage account. All tables are created automatically on startup: `auditlog`, `revokedtokens`, `productvariants`, `syncsettings`, `unfulfilledorders`, `scanhistory`, `fulfillmentshipments`, `shipmentscans`, `productlookup`, `printedlabels`.

## API Reference

All responses use a consistent envelope:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Human-readable message" }
```

### `GET /api/auth`

Validates the `access_token` cookie and returns the current authentication state. No credentials required.

**Response (authenticated)**
```json
{ "success": true, "data": { "authenticated": true, "userId": "staff" } }
```

**Response (not authenticated)**
```json
{ "success": true, "data": { "authenticated": false } }
```

### `POST /api/auth`

Validates email and password credentials and sets httpOnly JWT cookies. No JWT required for this endpoint (only `X-Internal-Secret`).

**Request body**
```json
{ "email": "admin@example.com", "password": "..." }
```

**Response**
```json
{ "success": true, "data": { "ok": true } }
```

Sets two `Set-Cookie` headers: `access_token` (24h) and `refresh_token` (30d), both `HttpOnly; SameSite=None; Path=/`.

### `POST /api/auth/refresh`

Validates the `refresh_token` cookie and issues a new `access_token` cookie. Checks the refresh token's JTI against the revocation table.

**Response (success)**
```json
{ "success": true, "data": { "ok": true } }
```

Sets a new `Set-Cookie` header for `access_token`.

### `DELETE /api/auth`

Revokes both token JTIs by writing them to the `revokedtokens` table. Sets `Max-Age=0` on both cookies, instructing the browser to delete them immediately.

**Response**
```json
{ "success": true, "data": { "ok": true } }
```

### `GET /api/product?barcode=<value>`

Looks up a Shopify product variant by barcode or SKU. Logs the scan result to Table Storage.

**Response (found)**
```json
{ "success": true, "data": { "found": true, "variant": { ... } } }
```

**Response (not found)**
```json
{ "success": true, "data": { "found": false, "scanned": "<value>" } }
```

### `GET /api/order?ref=<value>`

Looks up an order by name (e.g. `#1001`) or tag. Returns the full order with fulfillment orders and tracking metafields.

### `POST /api/draft-order`

Three actions dispatched by the `action` field:

| Action | Required fields | Description |
|---|---|---|
| `create` | `variantId`, `quantity` | Creates a new draft order |
| `add-item` | `draftOrderId`, `lineItems[]` | Replaces all line items |
| `complete` | `draftOrderId` | Completes the draft order and returns the created order |

### `POST /api/fulfill`

Reads tracking information from Shopify order metafields (`shipping/tracking_number`, `shipping/tracking_carrier`, `shipping/tracking_url`) and calls `fulfillmentCreateV2`. Logs the action to Table Storage.

| HTTP Status | Meaning |
|---|---|
| 200 | Fulfilled successfully |
| 404 | Order not found |
| 409 | Order already fulfilled |
| 422 | No tracking number on order, or no open fulfillment order |

### `GET /api/variant?q=<query>`

Searches by product title (`products` query, trailing wildcard) and by SKU (`productVariants` query, trailing wildcard), merges and deduplicates by variant ID.

### `PATCH /api/variant`

Assigns a barcode to a variant using `productVariantsBulkUpdate`.

**Request body**
```json
{ "productId": "gid://...", "variantId": "gid://...", "barcode": "1234567890" }
```

### `POST /api/sync/ship-orders`

Fetches fulfilled and partially-fulfilled orders that have tracking numbers from Shopify (GraphQL, paginated) and upserts them into the `fulfillmentshipments` table. Preserves existing scan progress for any fulfillment that has not yet been marked shipped. Returns `{ ok: true, synced: N }` where N is the number of fulfillments processed.

### `GET /api/ship-orders`

Returns all fulfillments in the `fulfillmentshipments` table that have `status != "shipped"`, ordered by `fulfillmentCreatedAt` descending. Each fulfillment includes the full `lineItems` array (with `quantityShipped` progress), tracking info, customer info, and order tags.

**Response**
```json
{ "fulfillments": [...], "total": 5 }
```

### `POST /api/shipment/scan`

Records a single product scan against a fulfillment. Matches by `fulfillmentLineItemId` (manual tap) or by barcode/SKU/PLU (scanner). Increments `quantityShipped` on the matched line item and logs a `ShipmentScanEntity`. Auto-detects EAN-13 variable weight barcodes (starts with `'2'`, exactly 13 digits).

**Request body**
```json
{
  "fulfillmentId": "gid://shopify/Fulfillment/12345",
  "barcode": "2012345001234",
  "scannedBy": "Alice",
  "isManualLineItem": false
}
```

**Response**
```json
{ "matched": true, "alreadyFull": false, "lineItemName": "...", "quantityShipped": 2, "quantityExpected": 3, "fulfillmentStatus": "partial" }
```

### `POST /api/shipment/complete`

Marks a fulfillment as `"shipped"` in Table Storage. If not all items are fully scanned (`totalShipped < totalExpected`), `reason` is required and `isManualComplete` is set to `true`. Does not touch Shopify fulfillment status.

**Request body**
```json
{ "fulfillmentId": "gid://shopify/Fulfillment/12345", "scannedBy": "Alice", "reason": "Item damaged" }
```

### `GET /api/shipment/history`

Returns shipped fulfillments. Supports optional query params: `from` (ISO date), `to` (ISO date), `scannedBy` (string, partial match), `type` (`incomplete` to filter manual-only), `tags` (comma-separated order tag filter).

### `GET /api/shipment/scans`

Returns all `ShipmentScanEntity` records for a given fulfillment, ordered by `ScannedAt`. Required query param: `fulfillmentId`.

### `GET /api/scale/lookup?itemNumber=<value>`

Looks up a `productlookup` row by scale item number (the `N` in the scale's `ITEM N` output).

**Response (found)**
```json
{ "success": true, "data": { "found": true, "itemNumber": "12345", "plu": "4011", "productTitle": "Bananas", "pricePerLb": 0.59 } }
```

**Response (not found)**
```json
{ "success": true, "data": { "found": false, "itemNumber": "12345" } }
```

### `GET /api/scale/products`

Returns every row in `productlookup`.

**Response**
```json
{ "success": true, "data": { "products": [ { "itemNumber": "12345", "plu": "4011", "productTitle": "Bananas", "pricePerLb": 0.59 } ], "total": 1 } }
```

### `POST /api/scale/products`

Creates a new `productlookup` row. `itemNumber`, `plu`, and `productTitle` are required.

**Request body**
```json
{ "itemNumber": "12345", "plu": "4011", "productTitle": "Bananas", "pricePerLb": 0.59 }
```

Returns `409 Conflict` if `itemNumber` is already mapped.

### `PATCH /api/scale/products`

Updates an existing `productlookup` row, matched by `itemNumber`. Same body shape as `POST`. Returns `404` if the item number doesn't exist.

### `DELETE /api/scale/products?itemNumber=<value>`

Deletes the `productlookup` row for the given item number. Returns `404` if it doesn't exist.

### `GET /api/scale/print-log`

Returns `printedlabels` audit entries, most recent first. Optional query params: `from`, `to` (EST date strings, `yyyy-MM-dd` or `yyyy-MM-dd HH:mm:ss`, compared lexicographically against `printedAtEst`), `plu`.

**Response**
```json
{ "success": true, "data": { "labels": [ { "id": "...", "itemNumber": "12345", "plu": "4011", "productTitle": "Bananas", "itemWeight": "1.23 lb", "printedAtEst": "2026-06-11 14:30:05", "qrPayload": "4011 | Bananas | 1.23 lb | 2026-06-11 14:30:05", "printedBy": "staff" } ], "total": 1 } }
```

### `POST /api/scale/print-log`

Logs a printed (or reprinted) label. `productTitle`, `qrPayload`, and `printedAtEst` are required; `printedAtEst` must be `yyyy-MM-dd HH:mm:ss`. `partitionKey`/`rowKey` are derived entirely from `printedAtEst` (EST) — no UTC timestamp is stored on this entity.

**Request body**
```json
{ "itemNumber": "12345", "plu": "4011", "productTitle": "Bananas", "itemWeight": "1.23 lb", "printedAtEst": "2026-06-11 14:30:05", "qrPayload": "4011 | Bananas | 1.23 lb | 2026-06-11 14:30:05" }
```

**Response**
```json
{ "success": true, "data": { "ok": true, "id": "20260611143005-<guid>" } }
```

### `GET /api/health`

Returns `{ "success": true, "data": { "status": "ok", "timestamp": "..." } }`. Exempt from `InternalSecretMiddleware`. Used by load balancer health checks.

## Shopify GraphQL Notes

- **API version**: `2025-01`. The `productVariantUpdate` mutation was removed in this version; barcode updates use `productVariantsBulkUpdate` which requires the parent `productId`.
- **Product title search**: The `productVariants` connection does not support filtering by product title. Title-based search uses the `products` connection and flattens variants client-side.
- **Trailing wildcards only**: Shopify search supports `query*` but not `*query`. Leading wildcards silently return zero results.
- **Rate limiting**: `ShopifyService` retries on HTTP 429 with exponential backoff, up to 3 attempts.

## Local Development

```bash
# Install Azure Functions Core Tools v4 if not present
npm install -g azure-functions-core-tools@4 --unsafe-perm true

cd functions
func start
```

Edit `local.settings.json` with real values before starting. The file is gitignored and must never be committed. For `AzureWebJobsStorage`, use Azurite or a real storage account connection string during local development only (Managed Identity cannot be used on a developer workstation without additional configuration).

## Building

```bash
dotnet build functions/ShipScan.Functions.csproj
dotnet publish functions/ShipScan.Functions.csproj --configuration Release --output ./publish
```

## Testing

The test project at `functions.tests/` uses xUnit and Moq.

```bash
dotnet test functions.tests/ShipScan.Functions.Tests.csproj --verbosity normal
```

**Test coverage**: 33 tests, 0 failures, 0 warnings. Ship Mode functions use the same `TableStorageService` and `ShopifyService` patterns tested by existing test classes; tables created automatically on startup include `fulfillmentshipments`, `shipmentscans`, `productlookup`, and `printedlabels`.

`ScaleFunction` (Scale & Print mode) is not yet covered by dedicated unit tests — its `TableStorageService` methods follow the same get/list/upsert/delete patterns as `ProductVariantEntity` and `FulfillmentShipmentEntity`, which are tested.

| Test class | Tests | Coverage area |
|---|---|---|
| `AuthServiceTests` | 19 | Credential validation (correct, wrong password, wrong email, empty password, email case-insensitive, password case-sensitive), access token generation/validation (tuples), refresh token generation/validation, JTI uniqueness, cross-key rejection (access token rejected as refresh and vice versa), duration parsing |
| `ShopifyServiceTests` | 7 | Variant lookup (found/not found), order lookup (found/not found), draft order (success/userErrors), product search flattening |
| `AuthServiceEdgeCaseTests` | 5 | Missing `JwtSecret` throws on construction, missing `JwtRefreshSecret` throws on construction, missing `AppEmail` throws on construction, missing `AppPassword` throws on construction, empty access token returns nulls |

`ShopifyService` is tested by mocking `HttpMessageHandler` via `Moq.Protected`, injected through `IHttpClientFactory`. No real Shopify calls are made during tests.

## Configuration Reference

| Setting | Default | Description |
|---|---|---|
| `ShopifyStoreDomain` | — | Required. Shopify store domain, e.g. `store.myshopify.com` |
| `ShopifyAccessToken` | — | Required. Shopify Admin API token |
| `ShopifyApiVersion` | `2025-01` | Shopify GraphQL API version |
| `AppEmail` | — | Required. Staff login email address |
| `AppPassword` | — | Required. Staff login password |
| `JwtSecret` | — | Required. HMAC-SHA256 signing key for access tokens; minimum 32 characters, 64+ recommended |
| `JwtRefreshSecret` | — | Required. HMAC-SHA256 signing key for refresh tokens; must differ from `JwtSecret` |
| `JwtExpiresIn` | `24h` | Access token lifetime. Supports `Nh` (hours) or `Nd` (days) |
| `JwtRefreshExpiresIn` | `30d` | Refresh token lifetime. Supports `Nh` (hours) or `Nd` (days) |
| `CookieSecure` | `true` | Set to `false` for local HTTP development only. Controls the `Secure` attribute on Set-Cookie headers. |
| `InternalApiSecret` | — | Required. Must match the `INTERNAL_API_SECRET` environment variable on the SWA |
| `AllowedOrigins` | `http://localhost:3000` | Comma-separated list of CORS-allowed origins |
| `StorageAccountName` | — | Required. Azure Storage account name (no `.table.core.windows.net`) |
