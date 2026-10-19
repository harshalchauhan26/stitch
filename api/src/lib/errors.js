import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Express error handler: turns every known error into { error, ...extra } with the right status. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ error: first?.message || 'Invalid data', fields: Object.keys(err.errors) });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: `Invalid value for ${err.path}` });
  if (err?.code === 11000) {
    // a unique index caught a duplicate the service-level check missed (e.g. two requests at the same moment)
    return res.status(409).json({ error: 'This already exists', duplicate: Object.keys(err.keyPattern || {}) });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on our side' });
}
