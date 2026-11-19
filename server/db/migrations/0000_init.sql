CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_order_id` integer NOT NULL,
	`line_id` integer,
	`user_id` integer,
	`filename` text NOT NULL,
	`stored_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`caption` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `work_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`phone` text,
	`email` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`can_authorize` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contacts_customer_idx` ON `contacts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_number` text,
	`phone` text,
	`email` text,
	`billing_address` text,
	`billing_city` text,
	`billing_state` text,
	`billing_zip` text,
	`payment_terms` text DEFAULT 'due_on_receipt' NOT NULL,
	`tax_exempt` integer DEFAULT false NOT NULL,
	`labor_rate_cents` integer,
	`parts_markup_pct` real,
	`requires_po` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inspection_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sections` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inspections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_order_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`technician_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`results` text DEFAULT '{}' NOT NULL,
	`mileage` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `inspection_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_id` integer NOT NULL,
	`qty` real NOT NULL,
	`reason` text NOT NULL,
	`work_order_id` integer,
	`purchase_order_id` integer,
	`user_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`work_order_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`issued_at` text NOT NULL,
	`due_at` text NOT NULL,
	`labor_cents` integer NOT NULL,
	`parts_cents` integer NOT NULL,
	`parts_cost_cents` integer DEFAULT 0 NOT NULL,
	`shop_supplies_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`voided` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_order_id` integer NOT NULL,
	`line_id` integer,
	`user_id` integer,
	`body` text NOT NULL,
	`customer_visible` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `work_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_number` text NOT NULL,
	`description` text NOT NULL,
	`manufacturer` text,
	`category` text,
	`vendor_id` integer,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`markup_pct` real,
	`list_price_cents` integer,
	`qty_on_hand` real DEFAULT 0 NOT NULL,
	`reorder_point` real DEFAULT 0 NOT NULL,
	`reorder_qty` real DEFAULT 0 NOT NULL,
	`bin_location` text,
	`taxable` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_number_idx` ON `parts` (`part_number`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`received_at` text NOT NULL,
	`user_id` integer,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pm_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`name` text NOT NULL,
	`interval_days` integer,
	`interval_miles` integer,
	`interval_hours` integer,
	`last_done_at` text,
	`last_done_miles` integer,
	`last_done_hours` real,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_order_id` integer NOT NULL,
	`part_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`vendor_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`created_by_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ordered_at` text,
	`received_at` text,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_number_unique` ON `purchase_orders` (`number`);--> statement-breakpoint
CREATE TABLE `shop_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`city` text,
	`state` text,
	`zip` text,
	`phone` text,
	`email` text,
	`default_labor_rate_cents` integer DEFAULT 14500 NOT NULL,
	`parts_tax_rate_pct` real DEFAULT 0 NOT NULL,
	`labor_tax_rate_pct` real DEFAULT 0 NOT NULL,
	`shop_supplies_pct` real DEFAULT 0 NOT NULL,
	`shop_supplies_cap_cents` integer DEFAULT 0 NOT NULL,
	`shop_supplies_base` text DEFAULT 'labor' NOT NULL,
	`shop_supplies_taxable` integer DEFAULT false NOT NULL,
	`markup_matrix` text NOT NULL,
	`invoice_footer` text
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`technician_id` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`line_id`) REFERENCES `work_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `te_tech_idx` ON `time_entries` (`technician_id`);--> statement-breakpoint
CREATE INDEX `te_line_idx` ON `time_entries` (`line_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`unit_number` text NOT NULL,
	`vin` text,
	`year` integer,
	`make` text,
	`model` text,
	`type` text DEFAULT 'tractor' NOT NULL,
	`license_plate` text,
	`engine` text,
	`mileage` integer,
	`engine_hours` real,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `units_customer_idx` ON `units` (`customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`phone` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`phone` text,
	`email` text,
	`account_number` text,
	`address` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `work_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_order_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`complaint` text,
	`cause` text,
	`correction` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`labor_hours` real DEFAULT 0 NOT NULL,
	`labor_rate_cents` integer NOT NULL,
	`technician_id` integer,
	`done` integer DEFAULT false NOT NULL,
	`pm_schedule_id` integer,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pm_schedule_id`) REFERENCES `pm_schedules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wol_wo_idx` ON `work_order_lines` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `wol_tech_idx` ON `work_order_lines` (`technician_id`);--> statement-breakpoint
CREATE TABLE `work_order_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`part_id` integer,
	`part_number` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`taxable` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `work_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wop_line_idx` ON `work_order_parts` (`line_id`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`customer_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`status` text DEFAULT 'estimate' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`summary` text,
	`po_number` text,
	`mileage_in` integer,
	`engine_hours_in` real,
	`service_writer_id` integer,
	`promised_at` text,
	`auth_token` text,
	`auth_sent_at` text,
	`authorized_at` text,
	`authorized_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	`invoiced_at` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_writer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_number_unique` ON `work_orders` (`number`);--> statement-breakpoint
CREATE INDEX `wo_status_idx` ON `work_orders` (`status`);--> statement-breakpoint
CREATE INDEX `wo_unit_idx` ON `work_orders` (`unit_id`);