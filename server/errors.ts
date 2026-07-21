import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_RATE_LIMITED"
  | "NO_AVAILABILITY";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: "VALIDATION_ERROR", message: "Endpoint không tồn tại" } });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = response.getHeader("x-request-id") || request.header("x-request-id");
  if (error instanceof ZodError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Dữ liệu không hợp lệ", details: error.flatten(), requestId },
    });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), requestId },
    });
    return;
  }
  console.error(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.message : "Unknown error" }));
  response.status(500).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Dịch vụ tạm thời không khả dụng", requestId } });
};
