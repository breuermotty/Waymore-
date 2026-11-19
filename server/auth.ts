import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '../shared/constants';
import { config } from './config';
import { HttpError } from './http';

export const COOKIE = 'wm_session';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: '12h' });
}

export function setSessionCookie(res: Response, user: SessionUser) {
  res.cookie(COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd && process.env.INSECURE_COOKIES !== '1',
    maxAge: 12 * 3600 * 1000,
  });
}

export const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return next(new HttpError(401, 'Not signed in'));
  try {
    const p = jwt.verify(token, config.jwtSecret) as SessionUser;
    req.user = { id: p.id, name: p.name, email: p.email, role: p.role };
    next();
  } catch {
    next(new HttpError(401, 'Session expired'));
  }
};

/** Admins pass every role check. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.user?.role;
    if (!role) return next(new HttpError(401, 'Not signed in'));
    if (role === 'admin' || roles.includes(role)) return next();
    next(new HttpError(403, 'You do not have permission to do that'));
  };
}

export function hasRole(req: Request, ...roles: Role[]) {
  const r = req.user?.role;
  return r === 'admin' || (r ? roles.includes(r) : false);
}
