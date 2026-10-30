import { useAuthStore } from "@/stores/auth-store";
import { fetchReviewJson } from "@/lib/client/review-client";
const owner = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", avatar: null, isVerified: true };
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, json: async () => value }) as Response;
beforeEach(() => { useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) }); global.fetch = jest.fn(); });
afterEach(() => jest.useRealTimers());
it("requires the expected current account before sending a private review request", async () => {
  await expect(fetchReviewJson("/api/user/reviews", {}, "another-buyer")).rejects.toMatchObject({ code: "REVIEW_ACCOUNT_CHANGED" }); expect(fetch).not.toHaveBeenCalled();
});
it("rejects copied owner payloads and results returned after a same-ID role change", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, ownerId: "another-buyer", reviews: [] }));
  await expect(fetchReviewJson("/api/user/reviews", {}, owner.id)).rejects.toMatchObject({ code: "REVIEW_ACCOUNT_CHANGED" });
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = fetchReviewJson("/api/user/reviews", {}, owner.id); useAuthStore.setState({ user: { ...owner, role: "MEMBER" } }); finish(response({ success: true, ownerId: owner.id, reviews: ["obsolete role data"] }));
  await expect(pending).rejects.toMatchObject({ code: "REVIEW_ACCOUNT_CHANGED" });
});
it("revalidates identity after a real session/role denial without accepting a fake empty result", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ success: false, code: "REVIEW_ACCOUNT_CHANGED", message: "Refresh your session" }, 409));
  await expect(fetchReviewJson("/api/user/reviews", {}, owner.id)).rejects.toMatchObject({ code: "REVIEW_ACCOUNT_CHANGED", status: 409 }); expect(useAuthStore.getState().fetchUser).toHaveBeenCalledTimes(1);
});
it("honors the deadline even when a test HTTP boundary ignores abort, and never publishes its late response", async () => {
  jest.useFakeTimers(); let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = fetchReviewJson("/api/reviews?productId=product");
  const rejected = expect(pending).rejects.toMatchObject({ code: "REVIEW_TIMEOUT" });
  await jest.advanceTimersByTimeAsync(30_001); finish(response({ success: true, reviews: [] })); await rejected;
});
