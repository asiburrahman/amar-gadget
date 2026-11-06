import { failureCategory, reportOperationFailure, serviceUnavailable } from "@/lib/observability";
import { errorReference, isIncidentId } from "@/lib/error-reference";
it("classifies dependency/database failures without logging raw errors, secrets, identities or SQL", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const error = Object.assign(new Error("postgresql://private:password@host/database customer@example.invalid SELECT private_data"), { code: "P1001", meta: { private: "secret" } });
    const incident = reportOperationFailure("catalog.list", error), record = JSON.parse(log.mock.calls[0][0]);
    expect(record).toEqual({ event: "operation_failed", level: "error", ...incident }); expect(incident.category).toBe("DATABASE_UNAVAILABLE"); expect(isIncidentId(incident.reference)).toBe(true);
    for (const privateValue of ["password", "customer@", "SELECT", "private_data", "secret", "stack", "meta"]) expect(JSON.stringify(log.mock.calls)).not.toContain(privateValue);
  } finally { log.mockRestore(); }
});
it("follows a bounded set of safe cause codes and handles cycles or hostile getters without stringifying them", () => {
  expect(failureCategory({ cause: { originalCode: "57014" } })).toBe("TIMEOUT"); expect(failureCategory({ code: "P2010", meta: { driverAdapterError: { cause: { code: "23505" } } } })).toBe("DATABASE_CONFLICT");
  const hostile = Object.defineProperty({ toString() { throw Error("Do not stringify me"); } }, "code", { get() { throw Error("Do not invoke getters"); } }); expect(failureCategory(hostile)).toBe("UNEXPECTED");
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic; expect(failureCategory(cyclic)).toBe("UNEXPECTED"); expect(failureCategory({ code: "raw provider response with secret" })).toBe("UNEXPECTED");
});
it("joins a sanitized thrown error to its log without retaining its cause or generating another incident on rethrow", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const first = serviceUnavailable("catalog.detail", Error("private original cause")), second = serviceUnavailable("catalog.detail", Error("other private cause"));
    expect(first.digest).not.toBe(second.digest); expect(errorReference(first)).toBe(first.incident.reference); expect(first).not.toHaveProperty("cause"); expect(first.message).not.toContain("private"); expect(JSON.stringify(first)).not.toContain("private original"); expect(JSON.parse(log.mock.calls[0][0]).reference).toBe(first.digest);
    expect(serviceUnavailable("catalog.page", first)).toBe(first); expect(log).toHaveBeenCalledTimes(2);
  } finally { log.mockRestore(); }
});
it("rejects unsafe operation labels and arbitrary error/reference content", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { expect(reportOperationFailure("request\nprivate@example.invalid", null).operation).toBe("application.unknown"); expect(JSON.stringify(log.mock.calls)).not.toContain("private@"); } finally { log.mockRestore(); }
  for (const error of [null, "private", { digest: "postgresql://private" }, { digest: "NEXT_REDIRECT;private" }, { digest: "123\nprivate" }]) expect(errorReference(error)).toBeNull();
  expect(errorReference({ digest: "123456789" })).toBe("123456789"); expect(errorReference(Object.defineProperty({}, "digest", { get() { throw Error("private getter"); } }))).toBeNull();
});
