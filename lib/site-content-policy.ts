import { createHash } from "node:crypto";
import type { SiteContentAddress, SiteContentMutation } from "@/lib/validations/site-content";

export class SiteContentError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "SITE_CONTENT_CONFLICT") { super(message); }
}

export function siteContentPath(address: SiteContentAddress) {
  return address.kind === "ARTICLE" ? `/blog/${encodeURIComponent(address.slug)}` : `/${address.slug}`;
}

export function siteContentDecisionHash(input: SiteContentMutation) {
  return createHash("sha256").update(JSON.stringify([
    "site-content-v1", input.kind, input.slug, input.version, input.action,
    input.action === "DRAFT" ? input.fields : null,
    input.action === "PUBLISH", input.reason,
  ])).digest("hex");
}
