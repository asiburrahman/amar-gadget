/** @jest-environment jsdom */
import { withBrowserLock } from "@/lib/client/browser-lock";

const original = Object.getOwnPropertyDescriptor(navigator, "locks");
afterEach(() => { if (original) Object.defineProperty(navigator, "locks", original); else Reflect.deleteProperty(navigator, "locks"); });

it("fulfills the native callback while preserving the exact work rejection for its caller", async () => {
  const failure = new Error("Stale revision"), callbackRejected = jest.fn();
  const request = jest.fn(async (_name: string, callback: () => Promise<unknown>) => {
    try { return await callback(); } catch (error) { callbackRejected(error); throw error; }
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  const work = jest.fn(async () => { throw failure; });
  await expect(withBrowserLock("guest-test", work)).rejects.toBe(failure);
  expect(request).toHaveBeenCalledWith("guest-test", expect.any(Function));
  expect(work).toHaveBeenCalledTimes(1); expect(callbackRejected).not.toHaveBeenCalled();
});

it("returns successful locked work without changing its value", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  const value = { durable: true }; await expect(withBrowserLock("guest-test", async () => value)).resolves.toBe(value);
});

it("does not run work if native lock acquisition fails", async () => {
  const failure = new Error("Lock unavailable"), work = jest.fn();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async () => { throw failure; } } });
  await expect(withBrowserLock("guest-test", work)).rejects.toBe(failure); expect(work).not.toHaveBeenCalled();
});

it("runs work once when Web Locks are unavailable", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const failure = new Error("Original work failure"), work = jest.fn(async () => { throw failure; });
  await expect(withBrowserLock("guest-test", work)).rejects.toBe(failure); expect(work).toHaveBeenCalledTimes(1);
});
