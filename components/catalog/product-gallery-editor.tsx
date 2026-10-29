"use client";
import { useId, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ProductImagePicker, type ProductImageSelection } from "@/components/forms/product-image-picker";
import { replaceGallerySchema, type GalleryItem } from "@/lib/validations/product-gallery";
import { productImageUrlSchema } from "@/lib/validations/product";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";
import { replaceProductGallery } from "@/server/actions/product/gallery-actions";
export function ProductGalleryEditor({ productId, version, urls }: { productId: string; version: number; urls: string[] }) {
  const [kept, setKept] = useState(urls), [cover, setCover] = useState(urls[0] ? `existing:${urls[0]}` : ""), [count, setCount] = useState(0);
  const [media, setMedia] = useState<ProductImageSelection>({ keys: [], ready: false });
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const router = useRouter(), coverId = useId();
  const items: GalleryItem[] = [...kept.map((url) => ({ source: "existing" as const, url })), ...media.keys.map((key) => ({ source: "upload" as const, key }))];
  const identity = (item: GalleryItem) => item.source === "existing" ? `existing:${item.url}` : `upload:${item.key}`;
  const selectedCover = items.some((item) => identity(item) === cover) ? cover : items[0] ? identity(items[0]) : "";
  const ready = count === 0 || media.ready;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || saved || !ready) return;
    setError("");
    const ordered = [...items.filter((item) => identity(item) === selectedCover), ...items.filter((item) => identity(item) !== selectedCover)];
    const parsed = replaceGallerySchema.safeParse({ productId, version, items: ordered });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the gallery."); return; }
    setBusy(true);
    try { const result = await replaceProductGallery(parsed.data); if (!result.success) { setError(result.error); return; } setChanged(result.data.changed); setSaved(true); router.refresh(); }
    catch { setError("Unable to save gallery. Your selected images are still here; reload before retrying."); }
    finally { setBusy(false); }
  };
  return <form aria-label="Edit product gallery" onSubmit={submit} className="space-y-5"><p>Keep, remove or replace saved images. The selected cover is first. Changes return the product to pending approval; removed managed images are queued for safe cleanup after at least 24 hours.</p>
    <fieldset disabled={busy || saved} className="space-y-4"><legend className="font-bold">Saved images</legend><ul className="grid sm:grid-cols-3 gap-4">{kept.map((url, index) => <li key={url} className="border rounded p-3 space-y-2"><div className="relative aspect-square">{productImageUrlSchema.safeParse(url).success ? <Image unoptimized={productImageNeedsDirectDelivery(url)} src={url} fill sizes="200px" alt={`Saved image ${index + 1}`} className="object-contain" /> : <p>No safe preview available.</p>}</div><button type="button" onClick={() => setKept(kept.filter((item) => item !== url))}>Remove saved image {index + 1}</button>{index > 0 && <button type="button" onClick={() => { const next = [...kept]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; setKept(next); }}>Move saved image {index + 1} up</button>}</li>)}</ul>
      <ProductImagePicker disabled={busy || saved} label="Add replacement images (optional)" maxImages={8 - kept.length} onCountChange={setCount} onChange={setMedia} />
      <label htmlFor={coverId} className="block font-bold">Cover image</label><select id={coverId} value={selectedCover} onChange={(event) => setCover(event.target.value)} className="border rounded p-2">{items.map((item, index) => <option key={identity(item)} value={identity(item)}>{item.source === "existing" ? "Saved" : "Uploaded"} image {index + 1}</option>)}</select>
      <p>{kept.length + count} of 8 selected images</p>
      <button type="submit" disabled={busy || saved || !ready || items.length === 0 || kept.length + count > 8} className="border rounded px-4 py-2">{busy ? "Saving gallery..." : "Save gallery"}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}{saved && <p role="status">{changed ? "Gallery saved. The product is awaiting approval. Reload if the updated gallery has not appeared." : "Gallery unchanged. The existing approval status is preserved."}</p>}
  </form>;
}
