import { renderSellerSettlementPage } from "@/components/settlements/seller-settlement-page";
export const dynamic = "force-dynamic";
export default async function SellerPayoutsPage() { return renderSellerSettlementPage("Seller payout history", "payouts"); }
