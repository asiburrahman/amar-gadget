import { renderSellerSettlementPage } from "@/components/settlements/seller-settlement-page";
export const dynamic = "force-dynamic";
export default async function SellerEarningsPage() { return renderSellerSettlementPage("Seller earnings and holds", "shipments"); }
