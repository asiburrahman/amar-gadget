export type Role = "ADMIN" | "MEMBER" | "USER";

/**
 * Checks if a user's role satisfies the required roles list.
 */
export function hasRole(userRole: string | undefined | null, allowedRoles: string[]): boolean {
  if (!userRole) return false;
  return allowedRoles.includes(userRole.toUpperCase());
}

/**
 * Utility to check if a user is an administrator.
 */
export function isAdmin(userRole: string | undefined | null): boolean {
  return userRole?.toUpperCase() === "ADMIN";
}

/**
 * Utility to check if a user is a member (seller/vendor) or admin.
 */
export function isMemberOrAdmin(userRole: string | undefined | null): boolean {
  if (!userRole) return false;
  const role = userRole.toUpperCase();
  return role === "ADMIN" || role === "MEMBER";
}