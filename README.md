# ShipScan

ShipScan is a mobile-first warehouse operations tool that integrates with Shopify. Staff scan product barcodes and order labels using their phone camera to perform point-of-sale transactions, ship fulfillments, and assign barcodes to product variants.

## Repository Structure

```
shipscan/
├── client/                  # Next.js 15 frontend (Azure Static Web Apps)
├── functions/               # Azure Functions .NET 8 backend
├── functions.tests/         # xUnit test project for the backend
├── .github/workflows/       # CI/CD pipelines
└── DEPLOY.md                # Infrastructure and deployment guide
```

## Architecture

```
Mobile Browser
    │
    ▼
Azure Static Web Apps (Next.js 15)
    │  Thin proxy routes add X-Internal-Secret header
    │  and forward the browser's httpOnly cookies
    ▼
Azure Functions (.NET 8, Isolated Worker)
    │  Validates X-Internal-Secret (gateway layer)
    │  Validates JWT from access_token cookie (per-endpoint)
    │  Checks JTI revocation table on every request
    │  Reads secrets from Azure Key Vault via app settings references
    ▼
Shopify Admin GraphQL API (2025-01)
    │
Azure Table Storage (audit log + revoked token JTIs, Managed Identity access)
```

All Shopify credentials and secrets live exclusively in Azure Key Vault. The frontend contains no API keys or secrets. Inter-service authentication uses two mechanisms:

- **Internal secret** (`X-Internal-Secret` header): ensures only the SWA proxy can call the Functions endpoint directly.
- **JWT in httpOnly cookie** (HMAC-SHA256): issued on staff email + password login; stored in a browser httpOnly cookie inaccessible to JavaScript; validated on every protected Functions route. A separate refresh token (30-day lifetime) allows silent access token renewal without re-entering credentials.

## Prerequisites

- Node.js 20+
- .NET 8 SDK
- Azure CLI
- Azure Functions Core Tools v4

## Quick Start (Local Development)

**1. Start the Azure Functions backend**

```bash
cd functions
# Edit local.settings.json with your Shopify credentials and secrets
func start
```

**2. Start the Next.js frontend**

```bash
cd client
# .env.local is already present for local dev
npm install
npm run dev
```

The application is available at `http://localhost:3000`. Staff credentials (`AppEmail` and `AppPassword`) are configured in `functions/local.settings.json`.

## CI/CD

Four GitHub Actions workflows handle deployment. Pushes to `develop` deploy to the test environment; pushes to `main` deploy to production. All Functions deployments run the full test suite before deploying.

| Workflow | Trigger | Target |
|---|---|---|
| `deploy-functions-test.yml` | `develop` branch, `functions/**` | `shipscan-api-test` |
| `deploy-functions-prod.yml` | `main` branch, `functions/**` | `shipscan-api-prod` |
| `deploy-frontend-test.yml` | `develop` branch, `client/**` | SWA test slot |
| `deploy-frontend-prod.yml` | `main` branch, `client/**` | SWA production |

Required GitHub secrets: `AZURE_CREDENTIALS_TEST`, `AZURE_CREDENTIALS_PROD`, `SWA_DEPLOYMENT_TOKEN_TEST`, `SWA_DEPLOYMENT_TOKEN_PROD`, `FUNCTIONS_URL_TEST`, `FUNCTIONS_URL_PROD`, `INTERNAL_API_SECRET_TEST`, `INTERNAL_API_SECRET_PROD`.

## Infrastructure

See [DEPLOY.md](DEPLOY.md) for the complete guide to provisioning Azure resources, Key Vault secrets, RBAC assignments, and environment configuration.
