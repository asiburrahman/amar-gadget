"use client";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { checkedAvatar, uploadAvatarFile, type ClientAvatar } from "@/lib/client/avatar-client";
import { validateAvatarFile } from "@/lib/avatar-policy";

export function useAvatarEditor(ownerId: string) {
  const [photo, setPhoto] = useState<ClientAvatar | null>(null);
  const [draft, setDraft] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false), working = useRef(false), generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const changeDraft = (file: File | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setDraft(file); setPreview(objectUrl.current);
  };
  const current = () => mounted.current && useAuthStore.getState().user?.id === ownerId;
  const accept = (saved: ClientAvatar) => {
    setPhoto(saved); setNeedsReload(false);
    const state = useAuthStore.getState();
    if (current() && (state.user?.avatarVersion ?? -1) <= saved.avatarVersion) state.updateUser({ avatar: saved.avatar, avatarVersion: saved.avatarVersion });
  };
  const reload = async () => {
    if (working.current || !current()) return;
    const ticket = ++generation.current;
    working.current = true; setBusy(true);
    try {
      const response = await fetch("/api/user/upload-avatar", { headers: { "X-Avatar-Owner": ownerId }, cache: "no-store", signal: controller.current?.signal });
      const data = await response.json();
      if (!current() || generation.current !== ticket) return;
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load the saved photo.");
      accept(checkedAvatar(data.photo, ownerId)); setMessage(draft ? "Saved photo reloaded. Your selected photo is still unsaved; choose Retry to upload it." : "");
    } catch (error) { if (current() && generation.current === ticket) { setNeedsReload(true); setMessage(error instanceof Error ? error.message : "Unable to load the saved photo."); } }
    finally { if (generation.current === ticket) { working.current = false; if (current()) setBusy(false); } }
  };
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    void reload();
    const cancel = () => { mounted.current = false; generation.current++; working.current = false; controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
    return cancel;
    // The parent keys this editor by account. Requests cannot outlive that owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
  const mutate = async (operation: "upload" | "remove" | "restore", file?: File) => {
    if (working.current || !current() || !photo || needsReload) return;
    working.current = true; generation.current++; setBusy(true); setMessage("");
    try {
      let saved: ClientAvatar;
      if (operation === "upload" && file) saved = await uploadAvatarFile(ownerId, photo.avatarVersion, file, controller.current?.signal);
      else {
        const response = await fetch("/api/user/upload-avatar", { method: operation === "remove" ? "DELETE" : "POST", headers: { "Content-Type": "application/json", "X-Avatar-Owner": ownerId }, body: JSON.stringify({ avatarVersion: photo.avatarVersion, ...(operation === "restore" ? { action: "restore-legacy" } : {}) }), signal: controller.current?.signal });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || "The photo change was not confirmed.");
        saved = checkedAvatar(data.photo, ownerId);
      }
      if (!current()) return;
      accept(saved); changeDraft(null); setMessage(operation === "remove" ? "Saved photo and older private copy removed. Cached copies can take time to expire." : "Profile photo saved.");
    } catch (error) { if (current()) { setNeedsReload(true); setMessage(error instanceof Error ? error.message : "Photo change was not confirmed. Reload before retrying."); } }
    finally { working.current = false; if (current()) setBusy(false); }
  };
  const selectFile = (file?: File) => {
    if (!file || working.current || !current()) return;
    const invalid = validateAvatarFile(file); if (invalid) { setMessage(invalid); return; }
    changeDraft(file);
    if (!photo || needsReload) { setMessage("Photo selected but not saved. Reload the saved photo before uploading."); return; }
    void mutate("upload", file);
  };
  return { photo, preview: preview || photo?.avatar || null, busy, draft, needsReload, message, selectFile, reload, retry: () => draft && mutate("upload", draft), discard: () => { if (!working.current) changeDraft(null); }, remove: () => mutate("remove"), restore: () => mutate("restore") };
}
