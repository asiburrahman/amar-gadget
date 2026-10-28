/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VerifyOtpPage from "../../app/(auth)/verify-otp/page";
import ResetPasswordPage from "../../app/(auth)/reset-password/page";
import { ProfileManager } from "../../components/dashboard/profile-manager";
import { useAuthStore } from "../../stores/auth-store";

const replace = jest.fn();
const push = jest.fn();
const setUser = jest.fn();
const refreshUser = jest.fn();
const updateUser = jest.fn();
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("email=signup%40example.invalid"), useRouter: () => ({ replace, push, refresh: jest.fn() }) }));
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ setUser, refreshUser, updateUser }) }));
const user = { id: "otp-ui", name: "Account owner", email: "old@example.invalid", role: "USER", phone: null, avatar: null, isVerified: true, createdAt: "2026-10-01T00:00:00Z", addresses: [] };
const response = (body: unknown, status = 200, retryAfter?: string) => ({ ok: status < 400, status, json: async () => body, headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : {}) }) as Response;
beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null });
  global.fetch = jest.fn();
});
afterEach(() => { jest.useRealTimers(); });

it("requires the registration password, preserves a leading-zero six-digit code and routes only after server success", async () => {
  jest.useFakeTimers();
  (fetch as jest.Mock).mockResolvedValue(response({ success: true, user: { ...user, role: "MEMBER" } }));
  render(<VerifyOtpPage />);
  const submit = screen.getByRole("button", { name: "Verify & Authenticate Account" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText(/Enter 6-Digit/), { target: { value: "012345" } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Registration password"), { target: { value: "Actual signup password" } });
  fireEvent.click(submit);
  await act(async () => undefined);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ email: "signup@example.invalid", otp: "012345", password: "Actual signup password" });
  expect(useAuthStore.getState().user?.role).toBe("MEMBER");
  expect(replace).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  expect(replace).toHaveBeenCalledWith("/member/dashboard");
});

it("keeps a rejected signup unauthenticated and prevents resend while verification is pending", async () => {
  let finish!: (result: Response) => void;
  (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  render(<VerifyOtpPage />);
  fireEvent.change(screen.getByLabelText(/Enter 6-Digit/), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("Registration password"), { target: { value: "Wrong password" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify & Authenticate Account" }));
  fireEvent.click(screen.getByRole("button", { name: "Resend OTP Code" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { finish(response({ success: false, message: "Invalid signup proof." }, 400)); });
  expect(screen.getByText("Invalid signup proof.")).toBeTruthy();
  expect(useAuthStore.getState().user).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it("honors server resend Retry-After without claiming a code was delivered", async () => {
  jest.useFakeTimers();
  (fetch as jest.Mock).mockResolvedValue(response({ success: false, message: "Please retry later." }, 429, "120"));
  render(<VerifyOtpPage />);
  fireEvent.click(screen.getByRole("button", { name: "Resend OTP Code" }));
  await act(async () => undefined);
  expect(screen.getByText("Please retry later.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Resend after 120s" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/has been sent/)).toBeNull();
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole("button", { name: "Resend after 119s" })).toBeTruthy();
});

async function openEmailForm() {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, user }));
  render(<ProfileManager />);
  fireEvent.click(await screen.findByRole("button", { name: /Change Email \+ OTP/ }));
  setUser.mockClear();
  fireEvent.change(screen.getByLabelText(/New Email Address/), { target: { value: "new@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Current secret" } });
}

it("reauthenticates before email delivery, requires all six digits and preserves the old email on rejection", async () => {
  await openEmailForm();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, email: "new@example.invalid" }));
  fireEvent.click(screen.getByRole("button", { name: /Send OTP Code/ }));
  const code = await screen.findByLabelText(/Enter OTP Code/);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ newEmail: "new@example.invalid", currentPassword: "Current secret" });
  expect(screen.queryByLabelText("Current password")).toBeNull();
  fireEvent.change(code, { target: { value: "1234" } });
  expect((screen.getByRole("button", { name: /Verify & Update/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(code, { target: { value: "012345" } });
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, message: "Invalid or expired code." }, 400));
  fireEvent.click(screen.getByRole("button", { name: /Verify & Update/ }));
  expect(await screen.findByText("Invalid or expired code.")).toBeTruthy();
  expect(JSON.parse((fetch as jest.Mock).mock.calls[2][1].body)).toEqual({ newEmail: "new@example.invalid", otp: "012345" });
  expect(setUser).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
  expect(screen.getAllByText("old@example.invalid").length).toBeGreaterThan(0);
});

it("requires fresh password entry when requesting another email-change code", async () => {
  jest.useFakeTimers();
  await openEmailForm();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, email: "new@example.invalid" }));
  fireEvent.click(screen.getByRole("button", { name: /Send OTP Code/ }));
  await waitFor(() => expect(screen.getByLabelText(/Enter OTP Code/)).toBeTruthy());
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  fireEvent.click(screen.getByRole("button", { name: "কোড পুনরায় পাঠান" }));
  expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("button", { name: /Send OTP Code/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("updates the account only from the successful email verification response", async () => {
  await openEmailForm();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, email: "new@example.invalid" }));
  fireEvent.click(screen.getByRole("button", { name: /Send OTP Code/ }));
  fireEvent.change(await screen.findByLabelText(/Enter OTP Code/), { target: { value: "012345" } });
  const confirmedUser = { ...user, email: "new@example.invalid" };
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, user: confirmedUser }));
  fireEvent.click(screen.getByRole("button", { name: /Verify & Update/ }));
  await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ email: confirmedUser.email, isVerified: true }));
  expect(refreshUser).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("new@example.invalid").length).toBeGreaterThan(0);
});

it("keeps the reauthentication form when email delivery fails", async () => {
  await openEmailForm();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, message: "Email delivery is temporarily unavailable." }, 503));
  fireEvent.click(screen.getByRole("button", { name: /Send OTP Code/ }));
  expect(await screen.findByText("Email delivery is temporarily unavailable.")).toBeTruthy();
  expect(screen.getByLabelText("Current password")).toBeTruthy();
  expect(screen.queryByLabelText(/Enter OTP Code/)).toBeNull();
  expect(setUser).not.toHaveBeenCalled();
});

it.each([true, false])("clears local authentication and redirects only after a successful password change: %s", async (success) => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, user }));
  render(<ProfileManager />);
  fireEvent.click(await screen.findByRole("button", { name: /Security/ }));
  setUser.mockClear();
  fireEvent.change(screen.getByLabelText(/Current Password/), { target: { value: "Existing password!123" } });
  fireEvent.change(screen.getByLabelText(/\(New Password\)/), { target: { value: "New password!123" } });
  fireEvent.change(screen.getByLabelText(/Confirm New Password/), { target: { value: "New password!123" } });
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success, message: "Credential conflict." }, success ? 200 : 409));
  fireEvent.click(screen.getByRole("button", { name: /Update Password/ }));
  if (success) {
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=password-changed"));
    expect(setUser).toHaveBeenCalledWith(null);
    expect((screen.getByLabelText(/Current Password/) as HTMLInputElement).value).toBe("");
  } else {
    expect(await screen.findByText("Credential conflict.")).toBeTruthy();
    expect(setUser).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  }
});

it("applies the shared password policy before reset and clears secrets after server confirmation", async () => {
  jest.useFakeTimers();
  render(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText(/Verification Code/), { target: { value: "012345" } });
  fireEvent.change(screen.getByLabelText(/\(New Password\)/), { target: { value: "12345678" } });
  fireEvent.change(screen.getByLabelText(/Confirm Password/), { target: { value: "12345678" } });
  fireEvent.click(screen.getByRole("button", { name: /Save New Password/ }));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/\(New Password\)/), { target: { value: "Reset password!123" } });
  fireEvent.change(screen.getByLabelText(/Confirm Password/), { target: { value: "Reset password!123" } });
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, message: "Sign in with your new password." }));
  fireEvent.click(screen.getByRole("button", { name: /Save New Password/ }));
  await act(async () => undefined);
  expect((screen.getByLabelText(/\(New Password\)/) as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("button", { name: /Save New Password/ }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(push).toHaveBeenCalledWith("/login");
});
