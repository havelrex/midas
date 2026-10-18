import type { ErrorRequestHandler } from 'express';

export type Logger = Pick<Console, 'info' | 'error'>;

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    switch (type) {
      case 'entity.parse.failed':
        res.status(400).json({ error: 'invalid JSON body' });
        return;
      case 'entity.too.large':
        res.status(413).json({ error: 'request body too large' });
        return;
      case 'charset.unsupported':
      case 'encoding.unsupported':
        res.status(415).json({ error: 'unsupported body encoding' });
        return;
    }
    // Provider errors can contain credentials or payloads. Never log them raw.
    logger.error('Unhandled request error');
    res.status(500).json({ error: 'internal server error' });
  };
}
