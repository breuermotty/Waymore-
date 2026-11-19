import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../shared/constants';
import { authenticate, COOKIE, requireRole, setSessionCookie } from '../auth';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { HttpError, idParam, notFound, parse, zOptStr } from '../http';
import { DEFAULT_MARKUP_MATRIX } from '../../shared/calc';
import { getSettings } from '../services/core';

export function authRoutes(db: DB) {
  const r = Router();

  r.post('/auth/login', (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const user = db.select().from(s.users).where(eq(s.users.email, email)).get();
    if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const session = { id: user.id, name: user.name, email: user.email, role: user.role };
    setSessionCookie(res, session);
    res.json({ user: session });
  });

  r.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  r.get('/auth/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  return r;
}

const userInput = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  phone: zOptStr,
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export function userRoutes(db: DB) {
  const r = Router();
  const cols = {
    id: s.users.id,
    name: s.users.name,
    email: s.users.email,
    role: s.users.role,
    phone: s.users.phone,
    active: s.users.active,
  };

  // Lightweight list for pickers (any signed-in user)
  r.get('/staff', (_req, res) => {
    res.json(db.select(cols).from(s.users).where(eq(s.users.active, true)).orderBy(s.users.name).all());
  });

  r.get('/users', requireRole(), (_req, res) => {
    res.json(db.select(cols).from(s.users).orderBy(s.users.name).all());
  });

  r.post('/users', requireRole(), (req, res) => {
    const body = parse(userInput.required({ password: true }), req.body);
    const { password, ...rest } = body;
    const row = db
      .insert(s.users)
      .values({ ...rest, passwordHash: bcrypt.hashSync(password, 10) })
      .returning(cols)
      .get();
    res.status(201).json(row);
  });

  r.put('/users/:id', requireRole(), (req, res) => {
    const id = idParam(req);
    const body = parse(userInput.partial(), req.body);
    const { password, ...rest } = body;
    if (id === req.user!.id && (rest.active === false || (rest.role && rest.role !== 'admin'))) {
      throw new HttpError(400, 'You cannot deactivate or demote your own account');
    }
    const row = db
      .update(s.users)
      .set({ ...rest, ...(password ? { passwordHash: bcrypt.hashSync(password, 10) } : {}) })
      .where(eq(s.users.id, id))
      .returning(cols)
      .get();
    if (!row) throw notFound('User');
    res.json(row);
  });

  return r;
}

const tier = z.object({ upToCents: z.number().int().positive().nullable(), markupPct: z.number().min(0).max(1000) });

const settingsInput = z.object({
  name: z.string().trim().min(1),
  address: zOptStr,
  city: zOptStr,
  state: zOptStr,
  zip: zOptStr,
  phone: zOptStr,
  email: zOptStr,
  defaultLaborRateCents: z.number().int().min(0),
  partsTaxRatePct: z.number().min(0).max(30),
  laborTaxRatePct: z.number().min(0).max(30),
  shopSuppliesPct: z.number().min(0).max(50),
  shopSuppliesCapCents: z.number().int().min(0),
  shopSuppliesBase: z.enum(['labor', 'labor_parts']),
  shopSuppliesTaxable: z.boolean(),
  markupMatrix: z.array(tier).min(1),
  invoiceFooter: zOptStr,
});

export function settingsRoutes(db: DB) {
  const r = Router();
  r.get('/settings', (_req, res) => {
    res.json(getSettings(db));
  });
  r.put('/settings', requireRole(), (req, res) => {
    const body = parse(settingsInput, req.body);
    const matrix = [...body.markupMatrix].sort((a, b) => (a.upToCents ?? Infinity) - (b.upToCents ?? Infinity));
    if (matrix[matrix.length - 1].upToCents !== null) matrix.push({ upToCents: null, markupPct: matrix[matrix.length - 1].markupPct });
    const current = getSettings(db);
    db.update(s.shopSettings)
      .set({ ...body, markupMatrix: JSON.stringify(matrix.length ? matrix : DEFAULT_MARKUP_MATRIX) })
      .where(eq(s.shopSettings.id, current.id))
      .run();
    res.json(getSettings(db));
  });
  return r;
}
