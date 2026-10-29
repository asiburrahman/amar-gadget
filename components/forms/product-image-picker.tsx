"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { uploadProductImage } from "@/lib/client/product-image-upload";
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_TYPES, validateProductImage } from "@/lib/product-media-policy";

type ImageItem = { id: string; file: File; preview: string; progress: number; status: "uploading" | "ready" | "error"; error?: string; fileKey?: string };
export type ProductImageSelection = { keys: string[]; ready: boolean };

export function ProductImagePicker({ disabled, onChange }: { disabled: boolean; onChange: (selection: ProductImageSelection) => void }) {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [error, setError] = useState("");
  const current = useRef<ImageItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    return () => { mounted.current = false; for (const control of active.values()) control.abort(); for (const item of current.current) URL.revokeObjectURL(item.preview); };
  }, []);
  const update = (next: ImageItem[]) => {
    if (!mounted.current) return;
    current.current = next; setItems(next);
    onChange({ keys: next.flatMap((item) => item.fileKey ? [item.fileKey] : []), ready: next.length > 0 && next.every((item) => item.status === "ready") });
  };
  const start = async (item: ImageItem) => {
    const control = new AbortController(); controllers.current.set(item.id, control);
    update(current.current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined, progress: 0, fileKey: undefined } : entry));
    try {
      const result = await uploadProductImage(item.file, control.signal, (progress) => update(current.current.map((entry) => entry.id === item.id ? { ...entry, progress } : entry)));
      if (!control.signal.aborted) update(current.current.map((entry) => entry.id === item.id ? { ...entry, status: "ready", progress: 100, fileKey: result.fileKey } : entry));
    } catch (failure) {
      if (!control.signal.aborted) update(current.current.map((entry) => entry.id === item.id ? { ...entry, status: "error", error: failure instanceof Error ? failure.message : "Image upload failed." } : entry));
    } finally { if (controllers.current.get(item.id) === control) controllers.current.delete(item.id); }
  };
  const remove = (item: ImageItem) => { controllers.current.get(item.id)?.abort(); controllers.current.delete(item.id); URL.revokeObjectURL(item.preview); update(current.current.filter((entry) => entry.id !== item.id)); };

  return <fieldset disabled={disabled} className="space-y-3 border-t border-border pt-3">
    <legend className="font-bold">Product images (required)</legend>
    <p id="product-image-help">JPEG, PNG or WebP, up to 5 MiB each. Add up to eight images; the first is the cover. Uploads finish before submission.</p>
    <input aria-label="Add product images" aria-describedby="product-image-help" type="file" multiple accept={PRODUCT_IMAGE_TYPES.join(",")} disabled={disabled || items.length >= MAX_PRODUCT_IMAGES} onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
      if (current.current.length + files.length > MAX_PRODUCT_IMAGES) { setError("Choose no more than eight images in total."); return; }
      const invalid = files.map(validateProductImage).find(Boolean);
      if (invalid) { setError(invalid); return; }
      setError("");
      const next = files.map((file): ImageItem => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), progress: 0, status: "uploading" }));
      update([...current.current, ...next]);
      // Keep provider requests bounded and avoid eight simultaneous full uploads.
      queue.current = queue.current.then(async () => { for (const item of next) if (mounted.current && current.current.some((entry) => entry.id === item.id)) await start(item); });
    }} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">{items.map((item, index) => <li key={item.id} className="border border-border rounded-lg p-2 space-y-2">
      <div className="relative aspect-square"><Image unoptimized fill sizes="180px" src={item.preview} alt={`Selected image ${index + 1}: ${item.file.name}`} className="object-contain" /></div>
      <p className="truncate">{index === 0 ? "Cover: " : ""}{item.file.name}</p>
      {item.status === "uploading" && <><progress aria-label={`Upload progress for ${item.file.name}`} max={100} value={item.progress} /><span>{item.progress}%</span></>}
      {item.status === "ready" && <p role="status">Uploaded</p>}
      {item.status === "error" && <><p role="alert" className="text-destructive">{item.error}</p><button type="button" onClick={() => void start(item)}>Retry {item.file.name}</button></>}
      {index > 0 && <button type="button" onClick={() => update([item, ...current.current.filter((entry) => entry.id !== item.id)])}>Use image {index + 1} as cover</button>}
      <button type="button" onClick={() => remove(item)}>Remove image {index + 1}</button>
    </li>)}</ul>
  </fieldset>;
}
