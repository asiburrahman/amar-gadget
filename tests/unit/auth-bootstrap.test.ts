/** @jest-environment jsdom */
beforeEach(() => { jest.resetModules(); localStorage.clear(); });

it("starts with the same unknown session as SSR despite a cached administrator profile", async () => {
  localStorage.setItem("amar_gadget_user", JSON.stringify({ id: "cached-admin", email: "cached@example.invalid", role: "ADMIN", name: "Cached administrator", isVerified: true }));
  const { useAuthStore } = await import("@/stores/auth-store");
  expect(useAuthStore.getInitialState()).toMatchObject({ user: null, loading: true, error: null });
  expect(useAuthStore.getState()).toMatchObject({ user: null, loading: true });
});

it("publishes and caches only the account returned by actual session verification", async () => {
  localStorage.setItem("amar_gadget_user", JSON.stringify({ id: "other-account", email: "other@example.invalid", role: "ADMIN" }));
  const { useAuthStore } = await import("@/stores/auth-store");
  const user = { id: "verified-buyer", email: "buyer@example.invalid", role: "USER", name: "Verified buyer", isVerified: true, avatar: null };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, user }) });
  await useAuthStore.getState().fetchUser();
  expect(useAuthStore.getState()).toMatchObject({ user: { id: user.id, role: "USER" }, loading: false, error: null });
  expect(JSON.parse(localStorage.getItem("amar_gadget_user")!)).toMatchObject({ id: user.id, role: "USER" });
});
