import type { ErrorRequestHandler, Request } from 'express';
import { z, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${issue?.message ?? 'Invalid input'}`, z.treeifyError(r.error));
  }
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const msg = String(err?.message ?? err);
  if (msg.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'A record with that value already exists.' });
    return;
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    res.status(409).json({ error: 'This record is in use and cannot be changed or removed.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};

/* Common zod field helpers */
export const zOptStr = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));
export const zMoney = z.coerce.number().int().min(0); // cents
export const zOptNum = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().nullable(),
);
