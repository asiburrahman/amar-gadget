// Only public diagnostics identifiers belong in an error fallback.
export function isIncidentId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function errorReference(error: unknown): string | null {
  try {
    if (!error || typeof error !== "object") return null;
    const digest = Object.getOwnPropertyDescriptor(error, "digest")?.value;
    return isIncidentId(digest) || (typeof digest === "string" && /^\d{1,20}$/.test(digest)) ? digest : null;
  } catch { return null; }
}
