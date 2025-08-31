import { RequestHandler } from 'express';

export function stripSensitiveHeaders(): RequestHandler {
  return (req, _res, next) => {
    // Never log these; they are transient BYOK headers.
    if (req.headers['x-provider-key']) {
      // Attach to request context but do not persist
      (req as any).providerKey = String(req.headers['x-provider-key']);
    }
    if (req.headers['x-provider']) {
      (req as any).provider = String(req.headers['x-provider']);
    }
    // Remove to avoid accidental logging by middleware
    delete req.headers['x-provider-key'];
    next();
  };
}

