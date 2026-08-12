/**
 * Converts a string into a URL-friendly slug.
 */
export function slugify(text: string): string {
  if (!text) return "";
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 -]/g, "") // Remove invalid chars
    .replace(/\s+/g, "-") // Collapse whitespace and replace by -
    .replace(/-+/g, "-"); // Collapse dashes
}