import { NextResponse } from "next/server";
import { ServiceUnavailableError, reportOperationFailure } from "@/lib/observability";
export function unavailableResponse(operation: string, error: unknown, message = "This service is temporarily unavailable. Try again shortly.") {
  const incident = error instanceof ServiceUnavailableError ? error.incident : reportOperationFailure(operation, error);
  return NextResponse.json({ success: false, code: "SERVICE_UNAVAILABLE", message, reference: incident.reference }, { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Error-Reference": incident.reference } });
}
