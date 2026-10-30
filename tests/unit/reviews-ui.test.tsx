/** @jest-environment jsdom */
import { runInThisContext } from "node:vm";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAuthStore } from "@/stores/auth-store";
import { ReviewForm } from "@/components/forms/review-form";
import { ReviewsDashboard } from "@/components/reviews/reviews-dashboard";
import { ProductReviews } from "@/components/reviews/product-reviews";
import { ProductCard } from "@/components/shared/product-card";
import type { OwnedReview, PublicReviewPage, ReviewAccess } from "@/lib/validations/review";
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }) }));
if (typeof Headers === "undefined") Object.defineProperty(globalThis, "Headers", { value: runInThisContext("Headers"), configurable: true });
const owner = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", avatar: null, isVerified: true, sellerStatus: "APPROVED" };
const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", product = { id: productId, slug: "purchased-gadget", name: "Purchased gadget", imageUrl: null };
const review: OwnedReview = { id: "review-id", version: 2, rating: 4, comment: "Original purchase feedback", product, status: "PUBLISHED", isCanonical: true, moderationReason: null, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z" };
const access = (value: Partial<ReviewAccess> = {}): ReviewAccess => ({ ownerId: owner.id, productId, review: null, eligible: true, reason: "Delivered paid purchase verified.", ...value });
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
const body = (init: RequestInit) => JSON.parse(String(init.body));
beforeEach(() => {
  jest.clearAllMocks(); useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) });
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, ...access() }));
});
it("submits chosen feedback and the expected owner, with no caller-selected purchase/status/identity", async () => {
  let saved = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => {
    if (init.method === "POST") { saved = true; expect((init.headers as Headers).get("X-Review-Owner")).toBe(owner.id); expect(body(init)).toEqual({ productId, rating: 3, comment: "Actual purchased experience" }); return response({ success: true, ownerId: owner.id, review: { ...review, rating: 3, comment: "Actual purchased experience", status: "PENDING" } }, 201); }
    return response({ success: true, ...access(saved ? { review: { ...review, status: "PENDING" } } : {}) });
  });
  render(<ReviewForm productId={productId} />);
  fireEvent.change(await screen.findByLabelText("Rating (1–5)"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText(/Your product experience/), { target: { value: "Actual purchased experience" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit review for moderation" }));
  expect(await screen.findByText("Review saved as pending. It will appear publicly after moderation.")).toBeTruthy(); expect(mockRefresh).toHaveBeenCalledTimes(1);
});
it("retains the user's draft on a failed/uncertain save and prevents duplicate in-flight submissions", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, ...access() })));
  const view = render(<ReviewForm productId={productId} />); fireEvent.change(await screen.findByLabelText("Rating (1–5)"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText(/Your product experience/), { target: { value: "Keep this customer draft" } });
  fireEvent.submit(view.container.querySelector("form")!); fireEvent.submit(view.container.querySelector("form")!);
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  await act(async () => finish(response({ success: false, message: "Review service unavailable", code: "REVIEW_UNAVAILABLE" }, 503)));
  expect(screen.getByRole("alert").textContent).toBe("Review service unavailable"); expect(screen.getByLabelText(/Your product experience/)).toHaveProperty("value", "Keep this customer draft"); expect(screen.getByLabelText("Rating (1–5)")).toHaveProperty("value", "4"); expect(mockRefresh).not.toHaveBeenCalled();
});
it("shows real ineligibility or login state without offering an unverified submission", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ success: true, ...access({ eligible: false, reason: "A delivered, paid purchase is required." }) }));
  const view = render(<ReviewForm productId={productId} />); await screen.findByText("A delivered, paid purchase is required."); expect(screen.queryByRole("button", { name: "Submit review for moderation" })).toBeNull();
  view.unmount(); (fetch as jest.Mock).mockClear(); useAuthStore.setState({ user: null }); render(<ReviewForm productId={productId} />);
  expect(screen.getByRole("link", { name: "Sign in with a verified account" }).getAttribute("href")).toBe("/login"); expect(fetch).not.toHaveBeenCalled();
});
it("requires withdrawal confirmation and sends the observed revision rather than deleting history blindly", async () => {
  let withdrawn = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => {
    if (init.method === "DELETE") { withdrawn = true; expect(body(init)).toEqual({ id: review.id, version: 2 }); return response({ success: true, ownerId: owner.id, review: { ...review, status: "WITHDRAWN", version: 3 } }); }
    return response({ success: true, ...access({ review: { ...review, ...(withdrawn ? { status: "WITHDRAWN" as const, version: 3 } : {}) } }) });
  });
  render(<ReviewForm productId={productId} />); fireEvent.click(await screen.findByRole("button", { name: "Withdraw my review" }));
  expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm withdraw review" })); expect(await screen.findByText("Review withdrawn. You can explicitly resubmit it later.")).toBeTruthy();
});
it("keeps oversized legacy text for explicit repair and does not invent a five-star replacement", async () => {
  const oldText = "x".repeat(2001);
  (fetch as jest.Mock).mockResolvedValue(response({ success: true, ...access({ review: { ...review, status: "LEGACY", rating: 9, comment: oldText } }) }));
  const view = render(<ReviewForm productId={productId} />); const input = await screen.findByLabelText("Rating (1–5)"); expect(input).toHaveProperty("value", "");
  expect(screen.getByLabelText(/Your product experience/)).toHaveProperty("value", oldText);
  fireEvent.change(input, { target: { value: "3" } }); fireEvent.submit(view.container.querySelector("form")!); await screen.findByRole("alert");
  expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "PUT")).toBe(false); expect(screen.getByLabelText(/Your product experience/)).toHaveProperty("value", oldText);
});
it("drops old account drafts and ignores a response which arrives after an account transition", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => (init.headers as Headers).get("X-Review-Owner") === owner.id ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, ...access({ ownerId: "other-buyer", eligible: false, reason: "No delivered purchases for this account." }) })));
  render(<ReviewForm productId={productId} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  act(() => useAuthStore.setState({ user: { ...owner, id: "other-buyer" } })); await screen.findByText("No delivered purchases for this account.");
  await act(async () => finish(response({ success: true, ...access({ review: { ...review, comment: "Old account private draft" } }) })));
  expect(screen.queryByDisplayValue("Old account private draft")).toBeNull(); expect(screen.queryByRole("button", { name: "Save changes for moderation" })).toBeNull();
});
it("does not redirect a late committed save into the new account's editor", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, ...access({ ownerId: (init.headers as Headers).get("X-Review-Owner")! }) })));
  render(<ReviewForm productId={productId} />); fireEvent.change(await screen.findByLabelText("Rating (1–5)"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Submit review for moderation" }));
  act(() => useAuthStore.setState({ user: { ...owner, id: "other-buyer" } })); await screen.findByRole("button", { name: "Submit review for moderation" });
  await act(async () => finish(response({ success: true, ownerId: owner.id, review: { ...review, status: "PENDING" } }, 201)));
  expect(screen.queryByText("Review saved as pending. It will appear publicly after moderation.")).toBeNull(); expect(mockRefresh).not.toHaveBeenCalled();
});
it("loads customer eligible products and keeps historical duplicates read-only", async () => {
  (fetch as jest.Mock).mockImplementation(async (url: string) => response({ success: true, ownerId: owner.id, page: 1, totalPages: 1, total: 1, ...(url.includes("tab=eligible") ? { products: [product] } : { reviews: [{ ...review, status: "LEGACY", isCanonical: false }] }) }));
  render(<ReviewsDashboard mode="customer" />); await screen.findByText(/historical duplicate, read-only/); expect(screen.queryByRole("button", { name: `Review or edit ${product.name}` })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Purchases eligible for a review" })); expect(await screen.findByRole("button", { name: `Write a review for ${product.name}` })).toBeTruthy();
});
it("requires an actual rejection reason, retains it on failure and submits the current moderator revision", async () => {
  useAuthStore.setState({ user: { ...owner, id: "admin", role: "ADMIN" } });
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => init.method === "POST" ? response({ success: false, message: "Review changed. Reload before moderating.", code: "REVIEW_CHANGED" }, 409) : response({ success: true, ownerId: "admin", reviews: [{ ...review, status: "PENDING", displayName: "Buyer" }], total: 1, page: 1, totalPages: 1 }));
  render(<ReviewsDashboard mode="admin" />); const reject = await screen.findByRole("button", { name: `Reject review ${review.id}` }); fireEvent.click(reject);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Explain why this review was rejected."); expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  fireEvent.change(screen.getByLabelText("Rejection reason (required when rejecting)"), { target: { value: "Please describe the purchased product." } }); fireEvent.click(reject);
  await screen.findByText("Review changed. Reload before moderating."); expect(screen.getByLabelText("Rejection reason (required when rejecting)")).toHaveProperty("value", "Please describe the purchased product.");
  const [, init] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "POST"); expect(body(init)).toEqual({ id: review.id, version: 2, action: "reject", reason: "Please describe the purchased product." }); expect((init.headers as Headers).get("X-Review-Owner")).toBe("admin");
});
it("renders seller feedback without moderator controls and does not call a failed list empty", async () => {
  useAuthStore.setState({ user: { ...owner, role: "MEMBER" } });
  (fetch as jest.Mock).mockResolvedValue(response({ success: true, ownerId: owner.id, page: 1, totalPages: 1, total: 1, reviews: [{ ...review, displayName: "Buyer", verifiedPurchase: true }] }));
  const view = render(<ReviewsDashboard mode="seller" />); await screen.findByText("Buyer — Verified purchase"); expect(screen.queryByRole("button", { name: /Publish review/ })).toBeNull();
  view.unmount(); (fetch as jest.Mock).mockResolvedValue(response({ success: false, message: "Review list unavailable" }, 503)); render(<ReviewsDashboard mode="seller" />);
  await screen.findByRole("alert"); expect(screen.queryByText("No published purchase reviews for your products.")).toBeNull();
});
const publicPage = (): PublicReviewPage => ({ productId, rating: 4, total: 21, page: 1, totalPages: 2, version: 1, reviews: Array.from({ length: 20 }, (_, index) => ({ id: `public-${index}`, rating: 4, comment: index ? `Actual review ${index}` : '<script>alert("text")</script>', displayName: `Reviewer ${index}`, verifiedPurchase: true, createdAt: review.createdAt, updatedAt: review.updatedAt })) });
it("renders actual review text as text, paginates and restarts a changed publication snapshot at page one", async () => {
  useAuthStore.setState({ user: null }); const initial = publicPage();
  const changed = { ...initial, version: 2, page: 1, total: 1, totalPages: 1, reviews: [{ ...initial.reviews[0], id: "changed", comment: "Current publication after moderation" }] };
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, ...initial, version: 2, page: 2, reviews: [initial.reviews[0]] })).mockResolvedValueOnce(response({ success: true, ...changed }));
  const view = render(<ProductReviews productId={productId} initialPage={initial} />); expect(screen.getByText('<script>alert("text")</script>')).toBeTruthy(); expect(view.container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next published reviews" })); await screen.findByText("Current publication after moderation"); expect(screen.getByText("Reviews changed while browsing. Showing the current first page.")).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([`/api/reviews?productId=${productId}&page=2`, `/api/reviews?productId=${productId}&page=1`]);
});
it("keeps a review outage distinct from an unrated product and removes the default five-star card claim", async () => {
  useAuthStore.setState({ user: null }); const view = render(<ProductReviews productId={productId} initialPage={null} />);
  expect(screen.getByRole("alert").textContent).toContain("temporarily unavailable"); expect(screen.queryByText("No published purchase reviews yet.")).toBeNull();
  view.unmount(); render(<ProductCard id={productId} name="Unrated product" price={100} stock={1} />);
  expect(screen.getByText("No reviews yet")).toBeTruthy(); expect(screen.queryByText("5.0/5")).toBeNull();
});
