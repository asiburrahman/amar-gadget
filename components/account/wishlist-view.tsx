"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";
export function WishlistView() {
  const scope = useWishlistStore((state) => state.scope);
  return <WishlistContent key={scope} />;
}
function WishlistContent() {
  const { items, status, busy, refreshing, error, scope, refresh, removeItem, clearWishlist } = useWishlistStore();
  const addCart = useCartStore((state) => state.addItem);
  const [page, setPage] = useState(1), [confirm, setConfirm] = useState(false), [added, setAdded] = useState("");
  const pages = Math.max(1, Math.ceil(items.length / 24)), currentPage = Math.min(page, pages), rows = items.slice((currentPage - 1) * 24, currentPage * 24);
  return <main className="max-w-6xl mx-auto px-4 py-8 space-y-5"><h1 className="text-3xl font-bold">My saved wishlist</h1><p>{scope === "guest" ? "Guest items stay in this browser. Sign in and explicitly merge to save them to an account." : "Your account wishlist syncs across sessions. Checkout confirms current prices and stock."}</p>
    <div className="flex flex-wrap gap-4"><button type="button" disabled={busy || refreshing || scope === "loading"} onClick={() => void refresh()}>Refresh wishlist</button><Link href="/products" className="underline">Browse products</Link>{scope === "guest" && <Link href="/login" className="underline">Sign in to sync</Link>}</div>
    {status === "loading" && <p role="status">Loading wishlist...</p>}{error && <p role="alert">{error}</p>}{added && <p role="status">{added}</p>}
    {status === "ready" && <><p>{items.length} saved item(s)</p>{items.length > 0 && <><button type="button" disabled={busy} onClick={() => setConfirm(true)}>Clear wishlist</button>{confirm && <div><p>Remove all items from this {scope === "guest" ? "browser guest list" : "account wishlist"}?</p><button type="button" disabled={busy} onClick={async () => { if (await clearWishlist()) setConfirm(false); }}>Confirm clear wishlist</button><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Keep wishlist</button></div>}</>}
      {!items.length && <p>Your wishlist is empty.</p>}<ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{rows.map((entry) => <li key={entry.id} className="border rounded-xl p-4 space-y-3">
        {entry.product ? <><Link href={`/products/${encodeURIComponent(entry.id)}`} className="block space-y-2"><div className="relative aspect-square">{entry.product.imageUrl ? <Image src={entry.product.imageUrl} unoptimized={productImageNeedsDirectDelivery(entry.product.imageUrl)} fill sizes="300px" alt={entry.product.name} className="object-contain" /> : <span>No image available</span>}</div><h2 className="font-bold">{entry.product.name}</h2></Link><p>{entry.product.category}</p><p>{formatCurrency(entry.product.discountPrice ?? entry.product.price)}</p><p>{entry.product.stock > 0 ? `${entry.product.stock} available` : "Out of stock"}</p><button type="button" disabled={busy || entry.product.stock <= 0} onClick={() => {
          const product = entry.product!; addCart({ id: product.id, name: product.name, price: product.price, discountPrice: product.discountPrice, stock: product.stock, imageUrl: product.imageUrl, category: product.category, quantity: 1 }); setAdded(`${product.name} added to cart. Checkout will confirm availability.`);
        }}>Add {entry.product.name} to cart</button></> : <><h2 className="font-bold">Product unavailable</h2><p>This saved product is no longer publicly available. You can remove it.</p></>}
        <button type="button" disabled={busy} aria-label={`Remove saved product ${entry.id}`} onClick={() => void removeItem(entry.id)}>Remove from wishlist</button>
      </li>)}</ul><nav aria-label="Wishlist pages" className="flex gap-4"><button disabled={busy || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous wishlist items</button><span>Page {currentPage} of {pages}</span><button disabled={busy || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next wishlist items</button></nav></>}
  </main>;
}
