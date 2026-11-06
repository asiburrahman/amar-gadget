/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAvatarEditor } from "@/hooks/use-avatar-editor";
import { safeAuthUser, useAuthStore } from "@/stores/auth-store";
import { registrationAvatar, stageRegistrationAvatar, clearRegistrationAvatar } from "@/stores/registration-avatar-store";
import VerifyOtpPage from "@/app/(auth)/verify-otp/page";
import RegisterPage from "@/app/(auth)/register/page";
import { ProfileManager } from "@/components/dashboard/profile-manager";
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }), useSearchParams: () => new URLSearchParams("email=buyer%40example.invalid") }));
// eslint-disable-next-line @next/next/no-img-element -- Test-only stand-in for Next Image; requests and image bytes have separate integration coverage.
jest.mock("next/image", () => ({ __esModule: true, default: ({ unoptimized: _unoptimized, ...props }: { unoptimized?: boolean; [key: string]: unknown }) => { void _unoptimized; return <img {...props} alt={String(props.alt || "")} />; } }));
const owner = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", avatar: null, avatarVersion: 0, isVerified: true };
const actualRefreshUser = useAuthStore.getState().fetchUser;
const actualLogout = useAuthStore.getState().logout;
const url = "https://cdn.example.invalid/avatars/buyer/00000000-0000-4000-8000-000000000001.webp";
const photo = (version = 0) => ({ ownerId: owner.id, avatar: version ? url : null, avatarVersion: version, legacyAvatarAvailable: false });
const response = (data: unknown, status = 200) => ({ ok: status < 300, status, json: async () => data }) as Response;
function Editor({ id = owner.id }: { id?: string }) {
  const editor = useAvatarEditor(id);
  return <div>
    <p role="status">{editor.message}</p><p>{editor.preview || "No photo"}</p>{editor.draft && <p>Unsaved draft</p>}
    <input aria-label="Photo" type="file" onChange={(e) => editor.selectFile(e.target.files?.[0])} />
    <button disabled={editor.busy || !editor.draft || editor.needsReload} onClick={() => void editor.retry()}>Retry</button>
    <button disabled={editor.busy} onClick={() => void editor.reload()}>Reload</button>
    <button disabled={editor.busy} onClick={editor.discard}>Discard</button>
    <button disabled={editor.busy} onClick={() => void editor.remove()}>Remove</button>
  </div>;
}
beforeEach(() => {
  jest.clearAllMocks(); clearRegistrationAvatar();
  useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) });
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, photo: photo() }));
  URL.createObjectURL = jest.fn().mockReturnValue("blob:local-draft"); URL.revokeObjectURL = jest.fn();
});
afterEach(() => { clearRegistrationAvatar(); jest.useRealTimers(); });
it("uploads the actual file/revision, uses only the server URL in the account store and releases its preview", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => response({ success: true, photo: photo(init.method === "POST" ? 1 : 0) }));
  const view = render(<Editor />); await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).not.toHaveProperty("disabled", true));
  const file = new File(["actual selected bytes"], "image.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [file] } });
  await screen.findByText("Profile photo saved."); expect(useAuthStore.getState().user).toMatchObject({ avatar: url, avatarVersion: 1, name: "Buyer" });
  const init = (fetch as jest.Mock).mock.calls.find(([, value]) => value.method === "POST")[1]; expect(init.headers["X-Avatar-Owner"]).toBe(owner.id); expect(init.body.get("file")).toBe(file); expect(init.body.get("avatarVersion")).toBe("0"); expect(init.body.get("name")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-draft"); view.unmount();
});
it("retains a failed photo draft, requires reload, avoids duplicate submissions and retries the observed new revision", async () => {
  let finish!: (value: Response) => void, fail = true;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => init.method === "POST" ? fail ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, photo: photo(3) })) : Promise.resolve(response({ success: true, photo: photo(fail ? 0 : 2) })));
  render(<Editor />); await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).not.toHaveProperty("disabled", true));
  const file = new File(["bytes"], "a.png", { type: "image/png" }); fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [file] } }); fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [file] } });
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  await act(async () => finish(response({ success: false, message: "Storage unavailable" }, 503))); expect(await screen.findByText("Unsaved draft")).toBeTruthy(); expect(useAuthStore.getState().user?.avatar).toBeNull(); expect(screen.getByRole("button", { name: "Retry" })).toHaveProperty("disabled", true);
  fail = false; fireEvent.click(screen.getByRole("button", { name: "Reload" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByText("Profile photo saved.");
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST")[1][1].body.get("avatarVersion")).toBe("2"); expect(useAuthStore.getState().user?.avatarVersion).toBe(3);
});
it("ignores an old owner's late upload and aborts the request on unmount", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, photo: photo() })));
  const view = render(<Editor />); await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toHaveProperty("disabled", false));
  fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [new File(["a"], "a.png", { type: "image/png" })] } });
  const init = (fetch as jest.Mock).mock.calls.find(([, value]) => value.method === "POST")[1];
  act(() => useAuthStore.setState({ user: { ...owner, id: "another" } })); view.unmount(); expect(init.signal.aborted).toBe(true);
  await act(async () => finish(response({ success: true, photo: photo(1) }))); expect(useAuthStore.getState().user).toMatchObject({ id: "another", avatar: null }); expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it("loads the current saved photo under StrictMode instead of retaining an aborted first read", async () => {
  render(<StrictMode><Editor /></StrictMode>); await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toHaveProperty("disabled", false)); expect(screen.getByText("No photo")).toBeTruthy(); expect(screen.getByRole("status").textContent).toBe("");
});
it("sanitizes old inline/remote cached avatars and accepts only revisioned owned public references", () => {
  for (const avatar of ["data:image/png;base64,YQ==", "https://remote.invalid/photo.png", url.replace("buyer", "another"), url + "?X-Amz-Signature=private"]) expect(safeAuthUser({ ...owner, avatar, avatarVersion: 1 })?.avatar).toBeNull();
  expect(safeAuthUser({ ...owner, avatar: url, avatarVersion: undefined })?.avatar).toBeNull(); expect(safeAuthUser({ ...owner, avatar: url, avatarVersion: 1 })?.avatar).toBe(url);
});
it("keeps one email-bound signup file in memory, expires it and prevents cross-account retrieval", () => {
  const file = new File(["bytes"], "photo.png", { type: "image/png" }); stageRegistrationAvatar(" Buyer@Example.invalid ", file); expect(registrationAvatar(owner.email)).toBe(file); expect(registrationAvatar("another@example.invalid")).toBeNull(); expect(localStorage.getItem("registration-avatar")).toBeNull();
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 15 * 60_000 + 1); try { expect(registrationAvatar(owner.email)).toBeNull(); } finally { now.mockRestore(); }
});
it("retains the registration photo feature without including image data in anonymous registration", async () => {
  useAuthStore.setState({ user: null }); (fetch as jest.Mock).mockResolvedValue(response({ success: true }));
  const view = render(<RegisterPage />); const file = new File(["photo"], "photo.png", { type: "image/png" });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.change(screen.getByPlaceholderText("e.g. Asibur Rahman"), { target: { value: "Buyer" } }); fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: owner.email } });
  const passwords = view.container.querySelectorAll('input[type="password"]'); for (const input of passwords) fireEvent.change(input, { target: { value: "Valid password!123" } });
  fireEvent.click(screen.getByRole("button", { name: "Register as Customer" })); await waitFor(() => expect(registrationAvatar(owner.email)).toBe(file)); const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body); expect(body).not.toHaveProperty("avatar"); expect(body).toMatchObject({ name: "Buyer", email: owner.email });
});
it("uploads a staged signup photo only after successful OTP authentication and offers retry after a failure", async () => {
  useAuthStore.setState({ user: null }); stageRegistrationAvatar(owner.email, new File(["photo"], "photo.png", { type: "image/png" })); let succeed = false;
  (fetch as jest.Mock).mockImplementation(async (path, init: RequestInit) => {
    if (path === "/api/auth/verify-otp") return response({ success: true, user: owner });
    if (init.method === "POST") return succeed ? response({ success: true, photo: photo(2) }) : response({ success: false, message: "Storage temporarily unavailable" }, 503);
    return response({ success: true, photo: photo(1) });
  });
  render(<VerifyOtpPage />); fireEvent.change(screen.getByLabelText("Enter 6-Digit Verification Code"), { target: { value: "123456" } }); fireEvent.change(screen.getByLabelText("Registration password"), { target: { value: "Valid password!123" } }); fireEvent.click(screen.getByRole("button", { name: "Verify & Authenticate Account" }));
  expect(await screen.findByText("Storage temporarily unavailable")).toBeTruthy(); expect(useAuthStore.getState().user?.id).toBe(owner.id); expect(registrationAvatar(owner.email)).not.toBeNull(); expect(mockReplace).not.toHaveBeenCalled(); expect(screen.queryByLabelText("Registration password")).toBeNull();
  succeed = true; fireEvent.click(screen.getByRole("button", { name: "Retry selected photo" })); await screen.findByText("Email verified and profile photo saved. Redirecting..."); expect(useAuthStore.getState().user).toMatchObject({ avatar: url, avatarVersion: 2 }); expect(registrationAvatar(owner.email)).toBeNull();
});
it("keeps typed profile fields out of avatar updates and omits stale photo references from a name/phone save", async () => {
  const profile = { ...owner, phone: "", createdAt: "2026-10-30T00:00:00.000Z", addresses: [] };
  (fetch as jest.Mock).mockImplementation(async (path, init: RequestInit) => {
    if (path === "/api/user/upload-avatar") return response({ success: true, photo: photo(init.method === "POST" ? 1 : 0) });
    if (init.method === "PUT") { const body = JSON.parse(String(init.body)); expect(body).toEqual({ name: "Unsaved typed name", phone: "" }); return response({ success: true, user: { ...profile, name: body.name, avatar: url, avatarVersion: 1 } }); }
    return response({ success: true, user: profile });
  });
  const view = render(<ProfileManager />); const name = await screen.findByPlaceholderText("e.g. Asibur Rahman"); await waitFor(() => expect(screen.getByRole("button", { name: "Reload saved photo" })).toHaveProperty("disabled", false));
  fireEvent.change(name, { target: { value: "Unsaved typed name" } }); fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
  await screen.findByText("Profile photo saved."); expect(name).toHaveProperty("value", "Unsaved typed name"); expect(useAuthStore.getState().user).toMatchObject({ name: "Buyer", avatar: url });
  fireEvent.submit(name.closest("form")!); await waitFor(() => expect(useAuthStore.getState().user?.name).toBe("Unsaved typed name"));
});
it("ignores older saved-photo revisions in late profile responses", () => {
  useAuthStore.getState().setUser({ ...owner, avatar: url, avatarVersion: 4 });
  useAuthStore.getState().updateUser({ avatar: null, avatarVersion: 2, name: "Saved profile name" }); expect(useAuthStore.getState().user).toMatchObject({ avatar: url, avatarVersion: 4, name: "Saved profile name" });
  useAuthStore.getState().setUser({ ...owner, avatar: null, avatarVersion: 1 }); expect(useAuthStore.getState().user).toMatchObject({ avatar: url, avatarVersion: 4 });
});
it("does not restore an earlier account from an auth read that finishes after account switch or completed logout", async () => {
  let finishRead!: (value: Response) => void, finishLogout!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((path) => new Promise<Response>((resolve) => { if (path === "/api/auth/logout") finishLogout = resolve; else finishRead = resolve; }));
  const first = actualRefreshUser(); useAuthStore.getState().setUser({ ...owner, id: "another" }); finishRead(response({ success: true, user: { ...owner, avatar: url, avatarVersion: 1 } })); await first;
  expect(useAuthStore.getState().user?.id).toBe("another");
  useAuthStore.getState().setUser(owner); const logout = actualLogout(), pending = actualRefreshUser();
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { finishLogout(response({ success: true })); await logout; expect(useAuthStore.getState().user).toBeNull(); finishRead(response({ success: true, user: { ...owner, avatar: url, avatarVersion: 1 } })); await pending; expect(useAuthStore.getState().user).toBeNull(); }
  finally { log.mockRestore(); }
});
