# Waymore

**Repair shop management for heavy-duty, diesel and fleet service shops.**
Waymore runs the whole job: check-in, estimate, customer approval, technician time and inspections, parts, invoice and payment. It also keeps every unit's preventive maintenance on schedule.

## Quick start

Requires **Node.js 20.19+ or 22+** (developed on Node 22).

```bash
npm install
npm run dev          # API on :4000 + web app on http://localhost:5173
```

On first start, Waymore creates `data/waymore.db` (SQLite) and loads demo data. Sign in with any demo account (password **`waymore123`**). The login screen also has one-click buttons:

| Role | Email | Lands on |
| --- | --- | --- |
| Admin | `admin@waymore.dev` | Dashboard, plus Settings and Users |
| Service writer | `writer@waymore.dev` | Dashboard |
| Technician | `tech@waymore.dev` | My Jobs (already clocked in to a job) |
| Parts manager | `parts@waymore.dev` | Dashboard, Inventory and POs |

### Production build

```bash
npm run build                       # builds the client into dist/
JWT_SECRET=change-me npm start      # serves API + client on http://localhost:4000
```

### Other scripts

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (business logic) + API integration tests (Vitest + supertest) |
| `npm run typecheck` | TypeScript check of server, client and shared code |
| `npm run db:reset` | Delete the local database and reload the demo data |
| `npm run db:generate` | Generate a new SQL migration after editing `server/db/schema.ts` |

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API / production server port |
| `DB_PATH` | `data/waymore.db` | SQLite database file |
| `UPLOAD_DIR` | `data/uploads` | Where photos and attachments are stored |
| `JWT_SECRET` | dev secret | **Set this in production.** Signs session cookies |
| `INSECURE_COOKIES` | unset | Set to `1` to allow non-HTTPS cookies when running `NODE_ENV=production` locally |

## Features

**Customers & fleets.** Customer accounts with contacts (primary / can-authorize), billing address, payment terms, tax-exempt status, a PO-required flag, and negotiated labor rate and parts markup overrides. Units have VIN (validated), year/make/model, type, plate, engine, odometer and engine hours, plus full service history.

**Work orders.** Created per unit, with priority (including *unit down*), PO #, mileage and hours in, and a promised date. Each job line follows the **complaint → cause → correction** format, with billed labor hours, labor rate and an assigned tech. The status flow is **Estimate → Approved → In Progress → Waiting on Parts → Complete → Invoiced**. Invoiced work orders are locked; voiding the invoice unlocks them.

**Estimates & customer authorization.** Click **Send for approval** to get a secure link. The customer opens it on any device and approves or declines each job with a typed signature. Writers can also record a phone approval. Declined work is tracked separately, and an invoice can't be generated while any line is still pending.

**Technicians.** The *My Jobs* board lets techs clock in and out with one tap. A tech can be on only one job at a time; clocking into a new job closes the previous one. A live timer shows in the header. Techs document cause and correction, upload photos and videos from a phone camera, add notes and run checklists. Three inspection checklists are included: **Annual DOT** (49 CFR 396.17 categories), **PM-A** and **Trailer PM**. Admins can add their own.

**Parts & inventory.** Parts catalog with bins, reorder points, vendors and stock history. Adding a stocked part to a job takes it out of inventory, and removing it puts it back. Pricing comes from a **tiered markup matrix**, with customer, part and fixed-price overrides. Purchase orders have draft → ordered → partial → received states. Receiving updates stock and last cost, and **Auto-reorder** drafts POs per vendor for low stock.

**Invoicing & payments.** Invoices are generated from completed work orders and bill approved lines only. They include **shop supplies** (a % of labor or labor + parts, with an optional cap) and **sales tax** (separate parts and labor rates, tax-exempt customers, optionally taxable supplies). Due dates follow payment terms. Partial and full payments can be recorded. The print view uses **Print / Save PDF**.

**Preventive maintenance.** PM schedules per unit by **days, miles and/or engine hours**, whichever comes first. A fleet-wide due list shows overdue and due-soon items, with one-click *Create WO*. Completing a work order that includes a PM line resets that schedule.

**Dashboard & reports.** The dashboard shows open WOs by status, month-to-date revenue, A/R and overdue, PM due, low stock, who's on the clock, and a 6-month revenue chart. Reports cover **technician productivity** (clocked vs. billed hours, efficiency %), **revenue** by month with parts gross profit and top customers, **parts usage** with margin, and **A/R aging**.

**Users & roles.** Admin, service writer, technician and parts manager, enforced by the API (not only hidden in the UI). Admins manage users, shop settings, tax and fees, and the markup matrix.

## Architecture

```
shared/         Pure TypeScript business logic used by both server and client
  calc.ts         totals, tax, shop supplies, markup matrix, labor time, efficiency, PM due, invoice balance
  money.ts        integer-cents money helpers
  constants.ts    roles, statuses, allowed status transitions
server/         Express 5 API
  db/schema.ts    Drizzle ORM schema (SQLite via better-sqlite3); migrations in db/migrations
  db/seed.ts      deterministic demo data (8 customers, 28 units, 44 parts, 56 work orders)
  routes/         auth/users/settings, customers & units & PM, work orders, parts & POs,
                  inspections, invoices, reports, public estimate approval
  services/core.ts work order loading + totals, pricing, stock moves, numbering
client/         React 19 + Vite + React Router single-page app (custom CSS, no UI kit)
```

- **Money** is stored and computed as integer cents. Tax is computed once on the combined base to avoid double rounding.
- **Auth** uses a JWT in an httpOnly, SameSite=Lax cookie. Passwords are hashed with bcrypt.
- **Input validation** uses zod on every write endpoint.
- **SQLite** keeps setup to zero. The Drizzle schema can be moved to Postgres by switching the dialect.

## Tests

`npm test` runs two suites:

- `shared/calc.test.ts` covers money rounding, the markup matrix and price precedence, labor time (open entries, rounding), efficiency, work order totals (declined lines, shop supplies cap and base, parts/labor tax, tax-exempt, fractional quantities), due dates, invoice balance, status transitions, and PM due by date, miles and hours.
- `server/api.test.ts` runs end-to-end API flows against an in-memory database: login and role enforcement, customer/unit/WO creation, catalog pricing and stock movement, customer approval via the public link, clock in/out, invoicing math and locking, payments, the pending-line guard, PO receiving, and reports.
