import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors.js";
import type { ErrorResponse } from "../schemas/api.js";

export function sendError(reply: FastifyReply, error: AppError): void {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.retryAfterSeconds !== undefined) {
    void reply.header("Retry-After", String(error.retryAfterSeconds));
  }
  void reply.code(error.statusCode).send(body);
}

export function handleRouteError(reply: FastifyReply, error: unknown): void {
  if (error instanceof AppError) {
    sendError(reply, error);
    return;
  }
  sendError(reply, new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500));
}

export function getRequestId(request: FastifyRequest): string {
  return request.id;
}
