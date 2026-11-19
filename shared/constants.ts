export const ROLES = ['admin', 'service_writer', 'technician', 'parts_manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  service_writer: 'Service Writer',
  technician: 'Technician',
  parts_manager: 'Parts Manager',
};

export const WO_STATUSES = [
  'estimate',
  'approved',
  'in_progress',
  'waiting_parts',
  'complete',
  'invoiced',
] as const;
export type WorkOrderStatus = (typeof WO_STATUSES)[number];

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  estimate: 'Estimate',
  approved: 'Approved',
  in_progress: 'In Progress',
  waiting_parts: 'Waiting on Parts',
  complete: 'Complete',
  invoiced: 'Invoiced',
};

/** Allowed manual status transitions. "invoiced" is only reachable by generating an invoice. */
export const WO_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  estimate: ['approved'],
  approved: ['estimate', 'in_progress', 'waiting_parts'],
  in_progress: ['waiting_parts', 'complete', 'approved'],
  waiting_parts: ['in_progress', 'approved'],
  complete: ['in_progress'],
  invoiced: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WO_TRANSITIONS[from]?.includes(to) ?? false;
}

export const LINE_STATUSES = ['pending', 'approved', 'declined'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const UNIT_TYPES = ['tractor', 'straight_truck', 'trailer', 'bus', 'pickup', 'reefer', 'equipment', 'other'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const PAYMENT_METHODS = ['check', 'ach', 'card', 'cash', 'fleet_card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_TERMS = ['due_on_receipt', 'net15', 'net30', 'net45', 'net60'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const PO_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const INSPECTION_RESULTS = ['pass', 'fail', 'na', 'repaired'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];
