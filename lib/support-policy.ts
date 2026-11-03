import { createHash } from "node:crypto";
import type { SupportSubmission, SupportStatusMutation } from "@/lib/validations/support";

export class SupportError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "SUPPORT_CONFLICT") { super(message); }
}

// Canonical explicit fields make retries independent of JSON property order.
// The hash is never used as a public lookup key or returned to a sender.
export function supportSubmissionHash(input: SupportSubmission) {
  return createHash("sha256").update(JSON.stringify([
    "support-submission-v1", input.name, input.email, input.topic,
    input.subject, input.orderReference ?? null, input.message, input.consent,
  ])).digest("hex");
}
export function supportDecisionHash(input: SupportStatusMutation) {
  return createHash("sha256").update(JSON.stringify([
    "support-status-v1", input.id, input.version, input.status, input.reason,
  ])).digest("hex");
}
