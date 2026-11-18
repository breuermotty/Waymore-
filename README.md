# Waymore shop app

Shop management for a heavy-duty repair shop: an **office web app** and a **tablet app for techs**, sharing one database.

## What it does
- **Board** – open work orders by status, techs on the clock, low-stock parts, unpaid invoices.
- **Work orders** – customer + unit, one job per complaint with cause / correction, tech assignment, estimated vs. billed hours, parts, notes.
- **Estimates & invoices** – labor at your rate, parts at cost + markup (or a set price), shop supplies (% of labor with a cap), sales tax; printable estimate and invoice. Invoicing locks the work order (Reopen to edit).
- **Parts inventory** – cost, price, on hand, reorder level. Parts put on a job come out of stock; removing them puts them back.
- **Tech time clock** (`/tech.html`) – PIN login, clock in/out on jobs, write cause/correction, add parts, mark jobs done. Clocking into a new job ends the previous punch; the tablet logs out after 3 idle minutes.
- **Settings** – shop name/address, labor rate, markup, supplies, tax, invoice terms.

## Run it
Needs Node.js 22.13 or newer.

```bash
npm install
npm run seed     # optional: sample customers, parts and techs (PINs 1111, 2222)
npm start        # http://localhost:3000  (tablets: http://<shop-computer-IP>:3000/tech.html)
npm test
```

Environment variables:
- `PORT` – default 3000
- `DB_FILE` – SQLite file, default `data/shop.db` (back this file up)
- `SHOP_PASSWORD` – if set, every page asks for this password. **Set it before putting the app on the internet.**
