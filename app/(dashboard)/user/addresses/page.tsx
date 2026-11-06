import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AddressManager } from "@/components/account/address-manager";
export default async function AddressesPage() {
  const user = await getCurrentUser(); if (!user) redirect("/login");
  return <AddressManager key={user.id} ownerId={user.id} />;
}
