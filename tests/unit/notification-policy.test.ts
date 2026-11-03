import { inboxAudiences, notificationMessage, NOTIFICATION_KINDS } from "@/lib/notification-policy";
it("keeps personal notices role independent while restricting seller and administrator audiences", () => {
  expect(inboxAudiences("USER")).toEqual(["ACCOUNT"]); expect(inboxAudiences("MEMBER")).toEqual(["ACCOUNT", "SELLER"]); expect(inboxAudiences("ADMIN")).toEqual(["ACCOUNT", "SELLER", "ADMIN"]); expect(() => inboxAudiences("forged-role")).toThrow();
});
it("creates bounded plain text and only existing internal destinations for every event kind/audience", () => {
  for (const kind of NOTIFICATION_KINDS) for (const audience of ["ACCOUNT", "SELLER", "ADMIN"]) {
    const result = notificationMessage({ kind, audience, data: { status: "PARTIALLY_DELIVERED" } }); expect(result.title.length).toBeLessThanOrEqual(120); expect(result.body.length).toBeLessThanOrEqual(600); expect(result.href).toMatch(/^\/(user|member|admin)\/[a-z-]+$/); expect(result.body).not.toContain("<");
  }
  expect(notificationMessage({ kind: "PAYOUT_STATUS", audience: "SELLER", data: { status: "RESERVED" } })).toMatchObject({ href: "/member/payouts", body: expect.stringContaining("reservation alone does not confirm") });
});
it("rejects arbitrary payload/redirect/template injection and never echoes unknown event data", () => {
  for (const data of [{ href: "https://foreign.example.invalid" }, { status: "<script>" }, { status: "PAID\nFORGED" }, { password: "private-value" }, null]) expect(() => notificationMessage({ kind: "ORDER_STATUS", audience: "ACCOUNT", data })).toThrow(); expect(() => notificationMessage({ kind: "UNKNOWN", audience: "ACCOUNT", data: {} })).toThrow();
});
