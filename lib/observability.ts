import { randomUUID } from "node:crypto";
export type FailureCategory = "DATABASE_UNAVAILABLE" | "DATABASE_CONFLICT" | "DATABASE_ERROR" | "TIMEOUT" | "DEPENDENCY_UNAVAILABLE" | "UNEXPECTED";
const codes: Record<string, FailureCategory> = {
  P1000: "DATABASE_UNAVAILABLE", P1001: "DATABASE_UNAVAILABLE", P1002: "DATABASE_UNAVAILABLE", P1008: "TIMEOUT", P1017: "DATABASE_UNAVAILABLE", P2021: "DATABASE_ERROR", P2022: "DATABASE_ERROR", P2024: "TIMEOUT", P2028: "DATABASE_ERROR", P2010: "DATABASE_ERROR", P2002: "DATABASE_CONFLICT", P2034: "DATABASE_CONFLICT",
  "08001": "DATABASE_UNAVAILABLE", "08006": "DATABASE_UNAVAILABLE", "57P01": "DATABASE_UNAVAILABLE", "53300": "DATABASE_UNAVAILABLE", "57014": "TIMEOUT", "40001": "DATABASE_CONFLICT", "40P01": "DATABASE_CONFLICT", "23505": "DATABASE_CONFLICT",
  ECONNREFUSED: "DEPENDENCY_UNAVAILABLE", ECONNRESET: "DEPENDENCY_UNAVAILABLE", ENOTFOUND: "DEPENDENCY_UNAVAILABLE", ETIMEDOUT: "TIMEOUT", ABORT_ERR: "TIMEOUT",
};
function ownValue(object: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
}
export function failureCategory(error: unknown): FailureCategory {
  let layer: unknown[] = [error]; const seen = new Set<object>(); let fallback: FailureCategory = "UNEXPECTED";
  for (let depth = 0; depth < 4; depth++) {
    const next: unknown[] = [];
    for (const candidate of layer) {
      if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
      seen.add(candidate);
      for (const field of ["code", "originalCode"]) { const value = ownValue(candidate, field); if (typeof value === "string" && Object.hasOwn(codes, value)) { if (codes[value] !== "DATABASE_ERROR") return codes[value]; fallback = "DATABASE_ERROR"; } }
      for (const field of ["cause", "meta", "driverAdapterError"]) next.push(ownValue(candidate, field));
    }
    layer = next;
  }
  return fallback;
}
export type OperationIncident = { reference: string; operation: string; category: FailureCategory };
export function reportOperationFailure(operation: string, error: unknown): OperationIncident {
  const incident = { reference: randomUUID(), operation: /^[a-z][a-z0-9_.-]{0,79}$/.test(operation) ? operation : "application.unknown", category: failureCategory(error) };
  // Never serialize error/message/stack, URLs/headers, identities or provider
  // metadata. Construct a small allowlisted record for stderr aggregation.
  console.error(JSON.stringify({ event: "operation_failed", level: "error", ...incident }));
  return incident;
}
export class ServiceUnavailableError extends Error {
  readonly digest: string;
  constructor(readonly incident: OperationIncident) {
    super("This service is temporarily unavailable. Try again shortly.");
    this.name = "ServiceUnavailableError";
    // The installed Next handler preserves an existing digest. This reference
    // joins the public fallback to its log, without retaining the raw cause.
    this.digest = incident.reference;
  }
}
export function serviceUnavailable(operation: string, error: unknown): ServiceUnavailableError {
  if (error instanceof ServiceUnavailableError) return error;
  return new ServiceUnavailableError(reportOperationFailure(operation, error));
}
