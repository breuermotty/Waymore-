import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

/* ----------------------------- Shop & users ----------------------------- */

export const shopSettings = sqliteTable('shop_settings', {
  id: id(),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  phone: text('phone'),
  email: text('email'),
  defaultLaborRateCents: integer('default_labor_rate_cents').notNull().default(14500),
  partsTaxRatePct: real('parts_tax_rate_pct').notNull().default(0),
  laborTaxRatePct: real('labor_tax_rate_pct').notNull().default(0),
  shopSuppliesPct: real('shop_supplies_pct').notNull().default(0),
  shopSuppliesCapCents: integer('shop_supplies_cap_cents').notNull().default(0),
  shopSuppliesBase: text('shop_supplies_base', { enum: ['labor', 'labor_parts'] }).notNull().default('labor'),
  shopSuppliesTaxable: integer('shop_supplies_taxable', { mode: 'boolean' }).notNull().default(false),
  /** JSON-encoded MarkupTier[] */
  markupMatrix: text('markup_matrix').notNull(),
  invoiceFooter: text('invoice_footer'),
});

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'service_writer', 'technician', 'parts_manager'] }).notNull(),
  phone: text('phone'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
});

/* -------------------------- Customers & units --------------------------- */

export const customers = sqliteTable('customers', {
  id: id(),
  name: text('name').notNull(),
  accountNumber: text('account_number'),
  phone: text('phone'),
  email: text('email'),
  billingAddress: text('billing_address'),
  billingCity: text('billing_city'),
  billingState: text('billing_state'),
  billingZip: text('billing_zip'),
  paymentTerms: text('payment_terms', { enum: ['due_on_receipt', 'net15', 'net30', 'net45', 'net60'] })
    .notNull()
    .default('due_on_receipt'),
  taxExempt: integer('tax_exempt', { mode: 'boolean' }).notNull().default(false),
  laborRateCents: integer('labor_rate_cents'), // null = shop default
  partsMarkupPct: real('parts_markup_pct'), // null = shop matrix
  requiresPo: integer('requires_po', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const contacts = sqliteTable(
  'contacts',
  {
    id: id(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    canAuthorize: integer('can_authorize', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('contacts_customer_idx').on(t.customerId)],
);

export const units = sqliteTable(
  'units',
  {
    id: id(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    unitNumber: text('unit_number').notNull(),
    vin: text('vin'),
    year: integer('year'),
    make: text('make'),
    model: text('model'),
    type: text('type').notNull().default('tractor'),
    licensePlate: text('license_plate'),
    engine: text('engine'),
    mileage: integer('mileage'),
    engineHours: real('engine_hours'),
    notes: text('notes'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('units_customer_idx').on(t.customerId)],
);

export const pmSchedules = sqliteTable('pm_schedules', {
  id: id(),
  unitId: integer('unit_id')
    .notNull()
    .references(() => units.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  intervalDays: integer('interval_days'),
  intervalMiles: integer('interval_miles'),
  intervalHours: integer('interval_hours'),
  lastDoneAt: text('last_done_at'),
  lastDoneMiles: integer('last_done_miles'),
  lastDoneHours: real('last_done_hours'),
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

/* ------------------------------ Parts ----------------------------------- */

export const vendors = sqliteTable('vendors', {
  id: id(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  accountNumber: text('account_number'),
  address: text('address'),
  notes: text('notes'),
});

export const parts = sqliteTable(
  'parts',
  {
    id: id(),
    partNumber: text('part_number').notNull(),
    description: text('description').notNull(),
    manufacturer: text('manufacturer'),
    category: text('category'),
    vendorId: integer('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    costCents: integer('cost_cents').notNull().default(0),
    markupPct: real('markup_pct'), // null = matrix / customer markup
    listPriceCents: integer('list_price_cents'), // fixed sell price overrides markup
    qtyOnHand: real('qty_on_hand').notNull().default(0),
    reorderPoint: real('reorder_point').notNull().default(0),
    reorderQty: real('reorder_qty').notNull().default(0),
    binLocation: text('bin_location'),
    taxable: integer('taxable', { mode: 'boolean' }).notNull().default(true),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('parts_number_idx').on(t.partNumber)],
);

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: id(),
  number: text('number').notNull().unique(),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => vendors.id),
  status: text('status', { enum: ['draft', 'ordered', 'partial', 'received', 'cancelled'] })
    .notNull()
    .default('draft'),
  notes: text('notes'),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: createdAt(),
  orderedAt: text('ordered_at'),
  receivedAt: text('received_at'),
});

export const purchaseOrderLines = sqliteTable('purchase_order_lines', {
  id: id(),
  purchaseOrderId: integer('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  quantity: real('quantity').notNull(),
  receivedQty: real('received_qty').notNull().default(0),
  unitCostCents: integer('unit_cost_cents').notNull(),
});

export const inventoryMoves = sqliteTable('inventory_moves', {
  id: id(),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id, { onDelete: 'cascade' }),
  qty: real('qty').notNull(), // + received, - used
  reason: text('reason', { enum: ['work_order', 'purchase_order', 'adjustment'] }).notNull(),
  workOrderId: integer('work_order_id'),
  purchaseOrderId: integer('purchase_order_id'),
  userId: integer('user_id'),
  note: text('note'),
  createdAt: createdAt(),
});

/* --------------------------- Work orders -------------------------------- */

export const workOrders = sqliteTable(
  'work_orders',
  {
    id: id(),
    number: text('number').notNull().unique(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    unitId: integer('unit_id')
      .notNull()
      .references(() => units.id),
    status: text('status', {
      enum: ['estimate', 'approved', 'in_progress', 'waiting_parts', 'complete', 'invoiced'],
    })
      .notNull()
      .default('estimate'),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'down'] })
      .notNull()
      .default('normal'),
    summary: text('summary'),
    poNumber: text('po_number'),
    mileageIn: integer('mileage_in'),
    engineHoursIn: real('engine_hours_in'),
    serviceWriterId: integer('service_writer_id').references(() => users.id),
    promisedAt: text('promised_at'),
    authToken: text('auth_token'),
    authSentAt: text('auth_sent_at'),
    authorizedAt: text('authorized_at'),
    authorizedBy: text('authorized_by'),
    createdAt: createdAt(),
    completedAt: text('completed_at'),
    invoicedAt: text('invoiced_at'),
  },
  (t) => [index('wo_status_idx').on(t.status), index('wo_unit_idx').on(t.unitId)],
);

/** A job / correction line: complaint, cause, correction (the "3 Cs"). */
export const workOrderLines = sqliteTable(
  'work_order_lines',
  {
    id: id(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    complaint: text('complaint'),
    cause: text('cause'),
    correction: text('correction'),
    status: text('status', { enum: ['pending', 'approved', 'declined'] })
      .notNull()
      .default('pending'),
    laborHours: real('labor_hours').notNull().default(0), // billed / book hours
    laborRateCents: integer('labor_rate_cents').notNull(),
    technicianId: integer('technician_id').references(() => users.id),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    pmScheduleId: integer('pm_schedule_id').references(() => pmSchedules.id, { onDelete: 'set null' }),
  },
  (t) => [index('wol_wo_idx').on(t.workOrderId), index('wol_tech_idx').on(t.technicianId)],
);

export const workOrderParts = sqliteTable(
  'work_order_parts',
  {
    id: id(),
    lineId: integer('line_id')
      .notNull()
      .references(() => workOrderLines.id, { onDelete: 'cascade' }),
    partId: integer('part_id').references(() => parts.id, { onDelete: 'set null' }),
    partNumber: text('part_number').notNull(),
    description: text('description').notNull(),
    quantity: real('quantity').notNull(),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
    unitPriceCents: integer('unit_price_cents').notNull(),
    taxable: integer('taxable', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('wop_line_idx').on(t.lineId)],
);

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: id(),
    lineId: integer('line_id')
      .notNull()
      .references(() => workOrderLines.id, { onDelete: 'cascade' }),
    technicianId: integer('technician_id')
      .notNull()
      .references(() => users.id),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
  },
  (t) => [index('te_tech_idx').on(t.technicianId), index('te_line_idx').on(t.lineId)],
);

export const notes = sqliteTable('notes', {
  id: id(),
  workOrderId: integer('work_order_id')
    .notNull()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  lineId: integer('line_id').references(() => workOrderLines.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id),
  body: text('body').notNull(),
  customerVisible: integer('customer_visible', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const attachments = sqliteTable('attachments', {
  id: id(),
  workOrderId: integer('work_order_id')
    .notNull()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  lineId: integer('line_id').references(() => workOrderLines.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id),
  filename: text('filename').notNull(),
  storedName: text('stored_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  caption: text('caption'),
  createdAt: createdAt(),
});

/* ---------------------------- Inspections ------------------------------- */

export const inspectionTemplates = sqliteTable('inspection_templates', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  /** JSON: { section: string; items: string[] }[] */
  sections: text('sections').notNull(),
});

export const inspections = sqliteTable('inspections', {
  id: id(),
  workOrderId: integer('work_order_id')
    .notNull()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  templateId: integer('template_id')
    .notNull()
    .references(() => inspectionTemplates.id),
  technicianId: integer('technician_id').references(() => users.id),
  status: text('status', { enum: ['open', 'complete'] })
    .notNull()
    .default('open'),
  /** JSON: Record<"sectionIdx.itemIdx", { result: InspectionResult; note?: string }> */
  results: text('results').notNull().default('{}'),
  mileage: integer('mileage'),
  createdAt: createdAt(),
  completedAt: text('completed_at'),
});

/* ---------------------------- Invoicing --------------------------------- */

export const invoices = sqliteTable('invoices', {
  id: id(),
  number: text('number').notNull().unique(),
  workOrderId: integer('work_order_id')
    .notNull()
    .references(() => workOrders.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  issuedAt: text('issued_at').notNull(),
  dueAt: text('due_at').notNull(),
  laborCents: integer('labor_cents').notNull(),
  partsCents: integer('parts_cents').notNull(),
  partsCostCents: integer('parts_cost_cents').notNull().default(0),
  shopSuppliesCents: integer('shop_supplies_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  voided: integer('voided', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
});

export const payments = sqliteTable('payments', {
  id: id(),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  receivedAt: text('received_at').notNull(),
  userId: integer('user_id').references(() => users.id),
});
