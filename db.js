import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name TEXT NOT NULL DEFAULT 'My Shop',
  shop_address TEXT NOT NULL DEFAULT '',
  shop_phone TEXT NOT NULL DEFAULT '',
  labor_rate REAL NOT NULL DEFAULT 150,
  parts_markup_pct REAL NOT NULL DEFAULT 30,
  shop_supplies_pct REAL NOT NULL DEFAULT 5,
  shop_supplies_cap REAL NOT NULL DEFAULT 75,
  tax_rate_pct REAL NOT NULL DEFAULT 0,
  tax_labor INTEGER NOT NULL DEFAULT 0,
  invoice_terms TEXT NOT NULL DEFAULT 'Payment due on receipt.'
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  mileage INTEGER
);

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY,
  part_number TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  price REAL,                -- NULL = cost marked up by settings.parts_markup_pct
  qty_on_hand REAL NOT NULL DEFAULT 0,
  reorder_at REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  unit_id INTEGER REFERENCES units(id),
  status TEXT NOT NULL DEFAULT 'estimate',
  mileage INTEGER,
  po_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  invoiced_at TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  complaint TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT '',
  correction TEXT NOT NULL DEFAULT '',
  tech_id INTEGER REFERENCES technicians(id),
  estimated_hours REAL NOT NULL DEFAULT 0,
  billed_hours REAL,          -- NULL = use clocked hours
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS part_lines (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES parts(id),
  part_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tech_id INTEGER NOT NULL REFERENCES technicians(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT
);
`;

export function openDb(file = process.env.DB_FILE || 'data/shop.db') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
