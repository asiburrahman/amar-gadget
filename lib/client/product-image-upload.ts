import { validateProductImage, type ProductImageType } from "@/lib/product-media-policy";

export type UploadedProductImage = { fileKey: string; publicUrl: string };
export async function uploadProductImage(file: File, signal: AbortSignal, onProgress: (percent: number) => void): Promise<UploadedProductImage> {
  const invalid = validateProductImage(file);
  if (invalid) throw new Error(invalid);
  const response = await fetch("/api/upload", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: file.type as ProductImageType, size: file.size }), signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success || typeof data.uploadUrl !== "string" || typeof data.fileKey !== "string" || typeof data.publicUrl !== "string") throw new Error(data?.message || "Unable to prepare image upload.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => { signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
    xhr.open("PUT", data.uploadUrl);
    xhr.timeout = 120_000;
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(data.headers ?? {})) if (typeof value === "string") xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? finish() : finish(new Error("Storage rejected the upload. Retry to request a fresh upload URL."));
    xhr.onerror = () => finish(new Error("Image upload failed. Check the connection and storage CORS configuration, then retry."));
    xhr.ontimeout = () => finish(new Error("Image upload timed out. Try again."));
    xhr.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { finish(new DOMException("Upload cancelled", "AbortError")); return; }
    xhr.send(file);
  });
  onProgress(100);
  return { fileKey: data.fileKey, publicUrl: data.publicUrl };
}
