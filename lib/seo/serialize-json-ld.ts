/** Serialize data for an HTML script element, not just for a JSON response. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
