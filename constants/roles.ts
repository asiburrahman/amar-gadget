export const ROLES = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER", // Seller
  USER: "USER",     // Customer
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];
