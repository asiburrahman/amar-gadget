import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { WishlistView } from "@/components/account/wishlist-view";
export default async function AccountWishlistPage() { if (!(await getCurrentUser())) redirect("/login"); return <WishlistView />; }
