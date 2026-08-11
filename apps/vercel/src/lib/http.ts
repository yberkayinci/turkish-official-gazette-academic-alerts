import { ZodError } from "zod";

import { AuthenticationError } from "./auth";
import { RequestSecurityError } from "./csrf";

type FieldErrors = Record<string, string>;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export function jsonSuccess<T>(data: T, message?: string, status = 200): Response {
  return Response.json(
    { ok: true, data, ...(message ? { message } : {}) },
    { status, headers: privateHeaders },
  );
}

export function jsonError(
  message: string,
  status: number,
  code: string,
  fieldErrors?: FieldErrors,
): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : {}),
      },
    },
    { status, headers: privateHeaders },
  );
}

export async function readJsonBody(request: Request, maximumBytes = 32_768): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ApiInputError("The request must use application/json.", "CONTENT_TYPE");
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) {
    throw new ApiInputError("The request body is too large.", "BODY_TOO_LARGE");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maximumBytes) {
    throw new ApiInputError("The request body is too large.", "BODY_TOO_LARGE");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new ApiInputError("The request body is not valid JSON.", "INVALID_JSON");
  }
}

export class ApiInputError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "INVALID_REQUEST", status = 400) {
    super(message);
    this.name = "ApiInputError";
    this.code = code;
    this.status = status;
  }
}

function zodFieldErrors(error: ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "request";
    if (!(path in result)) result[path] = issue.message;
  }
  return result;
}

export function handleApiError(error: unknown): Response {
  if (error instanceof AuthenticationError) {
    return jsonError("Authentication is required.", 401, "AUTH_REQUIRED");
  }
  if (error instanceof RequestSecurityError) {
    return jsonError("The request failed security validation.", 403, "REQUEST_FORBIDDEN");
  }
  if (error instanceof ApiInputError) {
    return jsonError(error.message, error.status, error.code);
  }
  if (error instanceof ZodError) {
    return jsonError("Review the highlighted fields.", 400, "VALIDATION_FAILED", zodFieldErrors(error));
  }

  const candidate = error as { name?: string; code?: string; message?: string } | null;
  if (
    candidate?.name === "RevisionConflictError" ||
    candidate?.name === "SettingsConflictError" ||
    candidate?.code === "REVISION_CONFLICT"
  ) {
    return jsonError(
      "Settings changed in another session. Reload the dashboard and try again.",
      409,
      "REVISION_CONFLICT",
    );
  }
  if (candidate?.name === "SettingsConfigurationError") {
    return jsonError(
      candidate.message || "The settings are not ready to be enabled.",
      400,
      "SETTINGS_NOT_READY",
    );
  }
  if (candidate?.name === "RateLimitError" || candidate?.code === "RATE_LIMITED") {
    return jsonError("Too many attempts. Wait before trying again.", 429, "RATE_LIMITED");
  }

  console.error("API request failed", {
    name: candidate?.name || "Error",
    code: candidate?.code || "UNEXPECTED",
  });
  return jsonError("The request could not be completed.", 500, "INTERNAL_ERROR");
}
