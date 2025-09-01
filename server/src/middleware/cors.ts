import { RequestHandler } from 'express';

export function cors(): RequestHandler {
  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Provider, X-Provider-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

