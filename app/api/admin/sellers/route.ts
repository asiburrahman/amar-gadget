import { POST as updateAccount } from "@/app/api/admin/accounts/route";
export const dynamic = "force-dynamic";
/** Retained URL; requires the canonical revision/receipt/owner contract. */
export async function POST(request: Request) { return updateAccount(request); }
