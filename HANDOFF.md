# VOUCH — Complete Project Handoff

**From:** Claude (Opus 4.6) — Design + Backend session, Feb 23 2026
**To:** OpenClaw (or any engineer deploying this)
**Domain:** getvouched.ai
**Launch:** Friday Feb 28, 2026 10am

---

## What Is VOUCH

VOUCH generates cryptographic proofs that AI agents followed their rules. An agent acts, VOUCH evaluates the action against a structured rule, and returns a signed, hashable, on-chain-verifiable proof.

**The pitch:** "Your agent says it followed the rules. VOUCH proves it."

---

## Project Structure — Two Repos

### 1. Frontend (Landing Page + Future Dashboard)
- **File:** `vouch-option-2.jsx` — Single-file React component
- **Deploy to:** Vercel (or Next.js on Railway)
- **Domain:** getvouched.ai
- **Stack:** React, inline CSS, no external deps beyond React
- **Current state:** Fully functional landing page with:
  - Ink diffusion hero animation (canvas)
  - Rule Library with 15 pre-built rules across 5 categories
  - Interactive demo that simulates proof generation
  - Proof ticker, editorial testimonials, pricing ($9.99 / $99 / Custom)
  - Responsive, monochrome + cyan accent (#22D3EE)

### 2. Backend (API + Proof Engine)
- **Directory:** `vouch-backend/`
- **Deploy to:** Railway
- **Domain:** api.getvouched.ai (or vouch-production.up.railway.app)
- **Stack:** Node.js 22, Fastify, TypeScript, PostgreSQL, Redis

---

## Backend File Map

```
vouch-backend/
├── package.json                    # Dependencies + scripts
├── tsconfig.json                   # TypeScript config
├── vitest.config.ts                # Test config
├── railway.json                    # Railway deploy config
├── .env.example                    # Every env var documented
├── .gitignore
│
├── migrations/
│   └── 001_init.sql                # 6 tables: users, agents, rules, proofs, rules_history, billing
│
├── scripts/
│   ├── generate-keys.ts            # Generates ECDSA, AES, JWT keys for .env
│   └── migrate.js                  # Runs SQL migrations
│
├── src/
│   ├── server.ts                   # Fastify entrypoint — registers all plugins + routes
│   ├── db.ts                       # PostgreSQL connection pool + query helpers
│   │
│   ├── services/
│   │   ├── rule-engine.ts          # ⭐ Core: evaluates conditions against action data
│   │   ├── proof-generator.ts      # ⭐ Core: Keccak256 → ECDSA sign → AES-256-GCM encrypt
│   │   └── auth.ts                 # bcrypt passwords, JWT RS256/HS256, API key gen
│   │
│   ├── middleware/
│   │   ├── auth.ts                 # JWT middleware (dashboard) + API key middleware (/prove)
│   │   └── error-handler.ts        # Sanitized errors, never leaks internals
│   │
│   ├── routes/
│   │   ├── auth.ts                 # POST /api/auth/signup, POST /api/auth/login
│   │   ├── prove.ts                # POST /api/prove ⭐, GET /api/prove/:id (public)
│   │   ├── agents.ts               # POST /api/agents, POST /api/agents/:id/rules, GET routes
│   │   └── dashboard.ts            # GET /api/dashboard/stats, /proofs, /pricing/estimate
│   │
│   ├── utils/
│   │   ├── schemas.ts              # Zod validation schemas for every endpoint
│   │   └── tiers.ts                # Pricing: free(10), starter($9.99/1K), growth($99/10K), enterprise
│   │
│   ├── jobs/
│   │   └── batch-proofs.ts         # Cron: batches proofs → Merkle root → on-chain tx
│   │
│   └── contracts/
│       ├── VouchRegistry.sol       # Solidity: batched proof storage with Merkle verification
│       └── RuleRegistry.sol        # Solidity: rule hash anchoring
│
└── tests/
    └── vouch.test.ts               # 30+ tests: rule engine, proof pipeline, auth, pricing
```

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/signup` | None | Create account, get JWT |
| POST | `/api/auth/login` | None | Login, get JWT |
| POST | `/api/agents` | JWT | Create agent, get API key (shown once) |
| GET | `/api/agents` | JWT | List user's agents |
| POST | `/api/agents/:id/rules` | JWT | Create a rule with structured conditions |
| GET | `/api/agents/:id/rules` | JWT | List agent's rules |
| **POST** | **`/api/prove`** | **API Key** | **⭐ Generate proof — core endpoint** |
| GET | `/api/prove/:id` | None (public) | Verify/view any proof |
| GET | `/api/dashboard/stats` | API Key | Usage stats, quota, pass rate |
| GET | `/api/dashboard/proofs` | API Key | Paginated proof history |
| GET | `/api/pricing/estimate` | None | Calculate cost for a tier |
| GET | `/health` | None | Health check for monitoring |

---

## How /api/prove Works (The Core Flow)

This is the most important endpoint. Here's exactly what happens:

```
Client sends:
{
  "rule_id": "uuid-of-the-rule",
  "action_data": { "slippage_pct": 0.38, "pool_tvl": 2100000 }
}

Server does:
1. Validates API key → finds agent + user
2. Checks proof quota (free tier = 10/mo hard cap)
3. Fetches rule by ID, confirms it belongs to this agent
4. ⭐ EVALUATES each condition against action_data:
   - slippage_pct (0.38) <= 0.5 → PASS
   - pool_tvl (2100000) > 50000 → PASS
   → rule_met = true
5. Builds deterministic JSON payload (sorted keys)
6. Hashes payload with Keccak256 → 0x7f2d8a...
7. Signs hash with ECDSA secp256k1 → 0x3044...
8. Encrypts signature with AES-256-GCM
9. Stores proof in DB (atomic nonce increment)
10. Returns proof to caller

Client receives:
{
  "proof_id": "uuid",
  "proof_hash": "0x7f2d8a...",
  "rule_met": true,
  "evaluation": [
    {"field": "slippage_pct", "op": "<=", "expected": 0.5, "actual": 0.38, "pass": true},
    {"field": "pool_tvl", "op": ">", "expected": 50000, "actual": 2100000, "pass": true}
  ],
  "summary": "All 2 conditions passed",
  "cost": "$0.0099",
  "on_chain": false,
  "verify_url": "https://getvouched.ai/proof/uuid"
}
```

**Key design decision:** The CLIENT does NOT tell VOUCH whether the rule was met. VOUCH evaluates it. This is what makes it a verifier, not a logger.

---

## Deployment Steps — Railway

### Step 1: Create Railway Project

1. Go to railway.app → New Project
2. Create two services:
   - **vouch-api** (Node.js)
   - **PostgreSQL** (add as Railway plugin)
3. Optionally add Redis (for rate limiting — can defer to Week 2)

### Step 2: Push Backend Code

```bash
# Extract the tar
tar -xzf vouch-backend.tar.gz
cd vouch-backend

# Init git
git init
git add .
git commit -m "VOUCH backend v1.0"

# Connect to Railway
railway link
railway up
```

Or push to GitHub and connect Railway to the repo.

### Step 3: Generate Keys

```bash
# Locally:
npm install
npx tsx scripts/generate-keys.ts
```

This outputs all keys. Copy them into Railway's environment variables.

### Step 4: Set Environment Variables in Railway

Go to vouch-api service → Variables tab. Set:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=${{Postgres.DATABASE_URL}}    # Railway auto-fills this
ECDSA_PRIVATE_KEY=<from generate-keys>
ENCRYPTION_KEY=<from generate-keys>
JWT_PRIVATE_KEY=<from generate-keys>
JWT_PUBLIC_KEY=<from generate-keys>
CORS_ORIGIN=https://getvouched.ai
LOG_LEVEL=info
```

For now, skip these (Phase 2):
```
REDIS_URL=              # Add when Redis is provisioned
RPC_URL=                # Add when Sepolia is ready
REGISTRY_CONTRACT_ADDRESS=  # After contract deploy
DEPLOYER_PRIVATE_KEY=       # After contract deploy
STRIPE_SECRET_KEY=          # After Stripe setup
```

### Step 5: Run Migrations

```bash
# In Railway shell or locally with DATABASE_URL pointing to Railway Postgres:
npm run migrate
```

### Step 6: Verify

```bash
curl https://your-app.up.railway.app/health
# Should return: {"status":"ok","version":"1.0.0","db":"connected"}
```

### Step 7: Custom Domain

In Railway → vouch-api → Settings → Custom Domain:
- Add: `api.getvouched.ai`
- Point DNS CNAME to the Railway domain

---

## Deployment Steps — Vercel (Frontend)

### Option A: Single-file React (current)

The landing page is a single `.jsx` file. To deploy on Vercel:

1. Create a Next.js project:
```bash
npx create-next-app@latest vouch-frontend --typescript
cd vouch-frontend
```

2. Copy `vouch-option-2.jsx` into `app/page.tsx` (wrap with 'use client' directive)

3. Push to GitHub → Connect to Vercel → Deploy

4. Set custom domain: `getvouched.ai`

### Option B: Static export

The landing page has no server dependencies. It can be a static site:
```bash
next build && next export
```
Deploy the `out/` folder to Vercel.

### Connecting Frontend to Backend

Currently the demo simulates proofs client-side. To connect to the real API:

1. Create a demo agent + rule in the backend
2. Get the demo API key
3. Replace the `generate()` function in the frontend to call:

```javascript
const res = await fetch('https://api.getvouched.ai/api/prove', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk_live_DEMO_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    rule_id: selectedRule.backendId,  // map frontend rules to backend rule IDs
    action_data: selectedRule.actionDataObj  // structured action data
  })
});
const proof = await res.json();
```

**Note:** For the landing page demo, consider creating a read-only demo agent with a hard proof limit (e.g., 100/day) to prevent abuse.

---

## Smart Contract Deployment (Sepolia)

### Prerequisites
- Node.js + Hardhat or Foundry
- Sepolia ETH (get from faucet)
- Alchemy or Infura Sepolia RPC URL

### Deploy with Hardhat

```bash
npx hardhat compile
npx hardhat run scripts/deploy.ts --network sepolia
```

### After deployment:
1. Copy contract addresses
2. Set `REGISTRY_CONTRACT_ADDRESS` and `RULE_REGISTRY_CONTRACT_ADDRESS` in Railway env vars
3. Set `DEPLOYER_PRIVATE_KEY` (the wallet that deployed — this is the `owner`)
4. Verify contracts on Etherscan:
```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

---

## Database Schema Summary

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Accounts | email, password_hash, tier, used_proofs_this_month |
| `agents` | API consumers | user_id, api_key_hash, proof_nonce |
| `rules` | Structured conditions | agent_id, conditions (JSONB), version |
| `proofs` | Generated proofs | proof_hash, signature_encrypted, rule_met, evaluation |
| `rules_history` | Audit log | rule_id, version, conditions snapshot |
| `billing` | Monthly charges | user_id, billing_month, total_charged |

---

## Pricing (Must Match Frontend)

| Tier | Monthly | Proofs Included | Overage Rate |
|------|---------|----------------|--------------|
| Free | $0 | 10 | Hard cap |
| Starter | $9.99 | 1,000 | $0.015/proof |
| Growth | $99 | 10,000 | $0.012/proof |
| Enterprise | Custom | 25K / 50K / 100K+ | Negotiated |

---

## Security Checklist

- [x] Passwords: bcrypt, cost factor 12
- [x] JWT: RS256 (asymmetric) with HS256 dev fallback
- [x] API keys: SHA-256 hashed, never stored plaintext
- [x] Signatures: AES-256-GCM encrypted at rest (authenticated encryption)
- [x] Nonces: atomic increment per agent (prevents replay)
- [x] Rate limiting: per API key + per IP
- [x] Input validation: Zod schemas on every endpoint
- [x] Error sanitization: no stack traces, no SQL errors, no field-specific auth failures
- [x] CORS: restricted to getvouched.ai in production
- [x] Helmet: security headers
- [x] Trust proxy: enabled for Railway

---

## What's Stubbed (Wire Later)

| Feature | Status | When |
|---------|--------|------|
| Stripe billing | Stubbed (tiers exist, Stripe calls are no-ops) | Week 1 post-launch |
| Redis rate limiting | Uses in-memory fallback via @fastify/rate-limit | Week 1 |
| On-chain batching | Job exists, skips if RPC not configured | After contract deploy |
| Email verification | Not implemented | Week 2 |
| Password reset | Not implemented | Week 2 |
| Webhook notifications | Not implemented | Month 2 |
| Dashboard frontend | Landing page only, no authenticated dashboard UI yet | Month 1 |

---

## Running Tests

```bash
cd vouch-backend
npm install
npm test
```

Tests cover:
- Rule engine: all 10 operators, missing fields, edge cases, validation
- Proof generator: deterministic hashing, ECDSA signing, AES encrypt/decrypt, full pipeline
- Auth: password hashing, API key generation, JWT roundtrip
- Pricing: tier calculations, overage math

Tests do NOT require a database or external services — they test pure logic.

---

## Design Decisions (Context for Future Work)

1. **Fastify over Express** — 2x throughput, built-in validation hooks, better TypeScript support

2. **ECDSA compact format (r+s+v)** instead of DER — directly compatible with Ethereum's `ecrecover`, so proofs can be verified on-chain without format conversion

3. **AES-256-GCM over CBC** — GCM provides authenticated encryption (detects tampering). CBC needs a separate HMAC.

4. **Merkle batching** — Instead of 1 proof = 1 blockchain tx ($0.10 each), we batch 500 proofs into 1 tx via Merkle root ($0.0003/proof). Individual proofs are still verifiable via Merkle inclusion proof.

5. **Server-side rule evaluation** — The original spec had clients send `rule_met: true`. That's an honor system, not verification. VOUCH evaluates rules against action data and determines the result. This is the core value prop.

6. **Nonce as source of truth in DB** — The database agent nonce is authoritative. On-chain nonces are synced via the batch job. If a batch fails, DB nonces don't drift.

7. **Two auth mechanisms** — JWT for human users (dashboard, management), API keys for machines (/prove). Different security profiles for different use cases.

---

## Quick Reference — Key Commands

```bash
# Install
npm install

# Generate all crypto keys
npx tsx scripts/generate-keys.ts

# Run DB migrations
npm run migrate

# Start dev server (hot reload)
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start

# Run batch job manually
npm run batch
```

---

*Built for Friday. Ship it. — CHAF*
