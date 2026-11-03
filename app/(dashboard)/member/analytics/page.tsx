import { renderSellerSettlementPage } from "@/components/settlements/seller-settlement-page";
export const dynamic = "force-dynamic";
export default async function SellerAnalyticsPage() { return renderSellerSettlementPage("Seller settlement analytics", "overview"); }
