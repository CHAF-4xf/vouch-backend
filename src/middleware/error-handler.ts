// ═══════════════════════════════════════════
// VOUCH Error Handler
// Never leaks internals. Consistent error shape.
// ═══════════════════════════════════════════

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export interface ApiError {
  error: string;
  code: string;
  status: number;
}

export function errorHandler(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  // Rate limit errors
  if (error.statusCode === 429) {
    return reply.code(429).send({
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMITED',
      status: 429,
    });
  }

  // Validation errors (Zod)
  if (error.validation) {
    return reply.code(400).send({
      error: 'Invalid request data',
      code: 'VALIDATION_ERROR',
      status: 400,
      details: error.message,
    });
  }

  // Known application errors
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: (error as any).code || 'CLIENT_ERROR',
      status: error.statusCode,
    });
  }

  // Unknown / server errors — log but don't expose
  req.log.error(error, 'Unhandled error');

  return reply.code(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    status: 500,
  });
}
